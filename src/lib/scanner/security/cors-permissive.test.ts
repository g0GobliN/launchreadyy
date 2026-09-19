import { describe, expect, it } from "vitest";
import { checkPermissiveCors } from "./cors-permissive";
import type { IssueInput } from "../../scanner-rules";

function run(files: Record<string, string>): IssueInput[] {
  const issues: IssueInput[] = [];
  checkPermissiveCors(files, issues);
  return issues;
}

describe("checkPermissiveCors", () => {
  /**
   * This is the exact shape the product's own FastAPI CORS fix used to generate — a wildcard
   * origin alongside credentials. The stack-profile corsDetector passes such a repo, because it
   * only asks whether CORS is configured at all, so nothing reported it.
   */
  it("flags FastAPI wildcard origins with credentials", () => {
    const issues = run({
      "app/cors.py": [
        'ALLOWED_ORIGINS = ["*"]',
        "app.add_middleware(",
        "    CORSMiddleware,",
        '    allow_origins=["*"],',
        "    allow_credentials=True,",
        ")",
      ].join("\n"),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("high");
    expect(issues[0]!.fixId).toBe("security-cors-permissive");
    expect(issues[0]!.foundEvidence).toContain("app/cors.py");
  });

  /**
   * The literal text this product's own fixer emitted before it was corrected. The wildcard is
   * reached through a conditional, so a pattern anchored right after `allow_origins=` walks past
   * it — which the first draft of this rule did, missing the very case that motivated it.
   */
  it("flags a wildcard reached through a conditional expression", () => {
    const issues = run({
      "app/cors.py": [
        'ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")]',
        "app.add_middleware(",
        "    CORSMiddleware,",
        '    allow_origins=ALLOWED_ORIGINS if "*" not in ALLOWED_ORIGINS else ["*"],',
        "    allow_credentials=True,",
        ")",
      ].join("\n"),
    });
    expect(issues).toHaveLength(1);
  });

  it("flags origins read from an env var defaulting to a wildcard", () => {
    const issues = run({
      "app/cors.py": [
        'ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")',
        "app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True)",
      ].join("\n"),
    });
    expect(issues).toHaveLength(1);
  });

  /** The corrected template gates credentials on the wildcard, so it must read as clean. */
  it("accepts the corrected template, which gates credentials on the wildcard", () => {
    expect(
      run({
        "app/cors.py": [
          'ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")]',
          'wildcard = "*" in ALLOWED_ORIGINS',
          "app.add_middleware(",
          "    CORSMiddleware,",
          '    allow_origins=["*"] if wildcard else ALLOWED_ORIGINS,',
          "    allow_credentials=not wildcard,",
          ")",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("accepts FastAPI credentials when origins are named", () => {
    expect(
      run({
        "app/cors.py": [
          "app.add_middleware(",
          "    CORSMiddleware,",
          '    allow_origins=["https://app.example.com"],',
          "    allow_credentials=True,",
          ")",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("accepts a wildcard when credentials are off", () => {
    expect(
      run({
        "app/cors.py": 'allow_origins=["*"]\nallow_credentials=False',
      }),
    ).toEqual([]);
  });

  it("flags Express cors() with a wildcard and credentials", () => {
    const issues = run({
      "src/app.ts": 'app.use(cors({ origin: "*", credentials: true }));',
    });
    expect(issues).toHaveLength(1);
  });

  it("flags Express origin:true with credentials, which reflects any origin", () => {
    expect(run({ "src/app.ts": "cors({ origin: true, credentials: true })" })).toHaveLength(1);
  });

  it("flags flask-cors with supports_credentials", () => {
    expect(run({ "app.py": 'CORS(app, origins="*", supports_credentials=True)' })).toHaveLength(1);
  });

  it("flags hand-rolled headers setting both", () => {
    const issues = run({
      "src/handler.ts": [
        'res.setHeader("Access-Control-Allow-Origin", "*");',
        'res.setHeader("Access-Control-Allow-Credentials", "true");',
      ].join("\n"),
    });
    expect(issues).toHaveLength(1);
  });

  it("does not flag a wildcard origin on its own", () => {
    expect(run({ "src/app.ts": 'res.setHeader("Access-Control-Allow-Origin", "*");' })).toEqual([]);
  });

  it("does not flag credentials on their own", () => {
    expect(run({ "src/app.ts": 'cors({ origin: "https://a.com", credentials: true })' })).toEqual(
      [],
    );
  });

  /** The pairing must occur in the same file to count — two unrelated files are not evidence. */
  it("does not pair a wildcard in one file with credentials in another", () => {
    expect(
      run({
        "a.py": 'allow_origins=["*"]',
        "b.py": "allow_credentials=True",
      }),
    ).toEqual([]);
  });

  it("aggregates across files into one finding", () => {
    const bad = 'cors({ origin: "*", credentials: true })';
    const issues = run({ "a.ts": bad, "b.ts": bad, "c.ts": bad });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.title).toContain("(3 found)");
  });

  it("discloses the sampling caveat", () => {
    const issues = run({ "a.ts": 'cors({ origin: "*", credentials: true })' });
    expect(issues[0]!.checkedFor!.join(" ")).toMatch(/sampled source files/);
  });

  it("stays quiet on a clean repo", () => {
    expect(run({ "src/app.ts": "const app = express();" })).toEqual([]);
  });
});
