import { describe, expect, it } from "vitest";
import { expressProfile } from "./express";
import type { SecurityScanProfileCtx } from "./types";

/** Every case here has the packages installed — what varies is whether they are wired up. */
function ctx(partial: Partial<SecurityScanProfileCtx>): SecurityScanProfileCtx {
  return {
    files: [],
    fileContents: {},
    deps: { express: "^4.19.0", helmet: "^7.1.0", cors: "^2.8.5", csurf: "^1.11.0" },
    ...partial,
  };
}

const configured = (signals: { kind: string }[]) => signals.length > 0;

describe("express stack profile security detectors", () => {
  /**
   * Regression: these fell back to `Boolean(ctx.deps[...])`, so a package listed in package.json
   * counted as the control being configured. Installing helmet from a tutorial and never calling
   * `app.use(helmet())` is ordinary, and it made the scan report security headers, CORS and CSRF
   * as present on an app that had none of them.
   */
  it("does not treat an installed-but-unwired package as configured", () => {
    const c = ctx({
      sourceContent: [
        'import express from "express";',
        "const app = express();",
        "app.listen(3000);",
      ].join("\n"),
    });
    expect(configured(expressProfile.headersDetector!(c))).toBe(false);
    expect(configured(expressProfile.corsDetector!(c))).toBe(false);
    expect(configured(expressProfile.csrfDetector!(c))).toBe(false);
  });

  it("does not treat a bare import as configured", () => {
    const c = ctx({
      sourceContent: [
        'import helmet from "helmet";',
        'import cors from "cors";',
        "const app = express();",
      ].join("\n"),
    });
    expect(configured(expressProfile.headersDetector!(c))).toBe(false);
    expect(configured(expressProfile.corsDetector!(c))).toBe(false);
  });

  it("detects middleware applied in the entry file", () => {
    const c = ctx({
      sourceContent: ["const app = express();", "app.use(helmet());", "app.use(cors());"].join(
        "\n",
      ),
    });
    expect(configured(expressProfile.headersDetector!(c))).toBe(true);
    expect(configured(expressProfile.corsDetector!(c))).toBe(true);
  });

  /** The dependency fallback existed for this case, so widening the corpus has to cover it. */
  it("detects middleware wired outside the entry file", () => {
    const c = ctx({
      sourceContent: "const app = express();",
      fileContents: { "src/middleware/index.ts": "app.use(helmet());\napp.use(cors());" },
    });
    expect(configured(expressProfile.headersDetector!(c))).toBe(true);
    expect(configured(expressProfile.corsDetector!(c))).toBe(true);
  });

  it("detects middleware built into an array rather than passed inline", () => {
    const c = ctx({ sourceContent: "const mw = [cors(), helmet()];\napp.use(mw);" });
    expect(configured(expressProfile.headersDetector!(c))).toBe(true);
    expect(configured(expressProfile.corsDetector!(c))).toBe(true);
  });

  it("detects csurf and double-csrf invocations", () => {
    expect(
      configured(expressProfile.csrfDetector!(ctx({ sourceContent: "app.use(csurf());" }))),
    ).toBe(true);
    expect(
      configured(
        expressProfile.csrfDetector!(
          ctx({ sourceContent: "const { doubleCsrf } = x; doubleCsrf({});" }),
        ),
      ),
    ).toBe(true);
  });

  it("does not match an identifier that merely starts with the package name", () => {
    const c = ctx({ sourceContent: "const corsOptions = {};\nconst helmetConfig = {};" });
    expect(configured(expressProfile.corsDetector!(c))).toBe(false);
    expect(configured(expressProfile.headersDetector!(c))).toBe(false);
  });

  it("still matches Express itself on the dependency, which is framework detection not a control", () => {
    expect(expressProfile.match(ctx({ sourceContent: "" }))).toBe(true);
  });

  it("reports cookie usage without the full secure flag set", () => {
    const c = ctx({ fileContents: { "src/auth.ts": 'res.cookie("sid", v, { httpOnly: true });' } });
    const signals = expressProfile.cookieDetector!(c);
    expect(signals[0]!.kind).toBe("heuristic");
  });
});
