import { describe, expect, it } from "vitest";
import { runCodePatternChecks } from "./code-patterns";
import type { IssueInput } from "../../scanner-rules";

function run(files: Record<string, string>): IssueInput[] {
  const issues: IssueInput[] = [];
  runCodePatternChecks(files, issues);
  return issues;
}

function byFix(files: Record<string, string>, fixId: string): IssueInput | undefined {
  return run(files).find((i) => i.fixId === fixId);
}

describe("disabled TLS verification", () => {
  it.each([
    ["src/http.ts", "const agent = new https.Agent({ rejectUnauthorized: false });"],
    ["src/api.py", "requests.get(url, verify=False)"],
    ["main.go", "tls.Config{InsecureSkipVerify: true}"],
    ["src/curl.php", "curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);"],
    ["app/net.rb", "http.verify_mode = OpenSSL::SSL::VERIFY_NONE"],
  ])("flags it in %s", (file, body) => {
    expect(byFix({ [file]: body }, "security-tls-verification")).toBeDefined();
  });

  /** The whole point of the rule: it is exact, not a guess, so it must claim high confidence. */
  it("reports as an exact match rather than a heuristic", () => {
    const found = byFix(
      { "src/http.ts": "const a = new https.Agent({ rejectUnauthorized: false });" },
      "security-tls-verification",
    );
    expect(found!.confidence).toBe("high");
    expect(found!.severity).toBe("high");
  });

  it("does not flag verification left on", () => {
    expect(
      byFix(
        { "src/http.ts": "const a = new https.Agent({ rejectUnauthorized: true });" },
        "security-tls-verification",
      ),
    ).toBeUndefined();
  });
});

describe("weak randomness", () => {
  it.each([
    ["src/auth.ts", "const resetToken = Math.random().toString(36).slice(2);"],
    ["src/session.js", "let sessionId = String(Math.random());"],
    ["app/otp.py", "otp_code = random.randint(100000, 999999)"],
    ["token.go", "apiKey := fmt.Sprint(rand.Intn(999999))"],
    ["src/gen.php", "$resetToken = mt_rand(100000, 999999);"],
  ])("flags a security value from a predictable source in %s", (file, body) => {
    expect(byFix({ [file]: body }, "security-weak-random")).toBeDefined();
  });

  /**
   * Bare `Math.random()` is overwhelmingly used for things that do not matter. Flagging it would
   * fire on nearly every front end, which is how a rule gets ignored.
   */
  it.each([
    ["src/ui.ts", "const jitter = Math.random() * 100;"],
    ["src/chart.ts", "const sampleData = points.map(() => Math.random());"],
    ["src/anim.ts", "element.style.left = `${Math.random() * 20}px`;"],
  ])("does not flag non-security randomness in %s", (file, body) => {
    expect(byFix({ [file]: body }, "security-weak-random")).toBeUndefined();
  });
});

describe("weak crypto", () => {
  it("flags MD5 applied to a password", () => {
    expect(
      byFix(
        { "src/auth.ts": 'crypto.createHash("md5").update(password).digest("hex")' },
        "security-weak-crypto",
      ),
    ).toBeDefined();
  });

  it("flags hashlib over a password", () => {
    expect(
      byFix(
        { "app/auth.py": "hashlib.sha1(password.encode()).hexdigest()" },
        "security-weak-crypto",
      ),
    ).toBeDefined();
  });

  it("flags ECB mode and the IV-less createCipher", () => {
    expect(
      byFix({ "src/c.ts": 'crypto.createCipher("aes-256-cbc", key)' }, "security-weak-crypto"),
    ).toBeDefined();
    expect(
      byFix({ "src/c.py": "AES.new(key, AES.MODE_ECB)" }, "security-weak-crypto"),
    ).toBeDefined();
  });

  /**
   * MD5 for an ETag or a cache key is correct and common. Requiring credential context on the
   * same expression is what separates this rule from noise.
   */
  it.each([
    ["src/etag.ts", 'const etag = crypto.createHash("md5").update(body).digest("hex");'],
    ["src/cache.ts", 'const cacheKey = crypto.createHash("sha1").update(url).digest("hex");'],
    ["src/hash.py", "checksum = hashlib.md5(file_bytes).hexdigest()"],
  ])("does not flag non-credential hashing in %s", (file, body) => {
    expect(byFix({ [file]: body }, "security-weak-crypto")).toBeUndefined();
  });
});

describe("path traversal", () => {
  it.each([
    ["src/files.ts", "fs.readFile(path.join(UPLOADS, req.query.name), cb);"],
    ["src/dl.ts", "res.sendFile(req.params.filename);"],
    ["app/views.py", "return send_file(request.args.get('path'))"],
    ["app/docs.rb", "File.read(params[:path])"],
    ["src/inc.php", "readfile($_GET['file']);"],
  ])("flags a path built from request input in %s", (file, body) => {
    expect(byFix({ [file]: body }, "security-path-traversal")).toBeDefined();
  });

  it("does not flag a path built from constants", () => {
    expect(
      byFix(
        { "src/files.ts": 'fs.readFile(path.join(__dirname, "templates", "index.html"), cb);' },
        "security-path-traversal",
      ),
    ).toBeUndefined();
  });

  /** A database id is not a path; looking the record up first is the recommended fix. */
  it("does not flag a lookup by id", () => {
    expect(
      byFix(
        {
          "src/files.ts":
            "const doc = await db.docs.find(req.params.id);\nfs.readFile(doc.path, cb);",
        },
        "security-path-traversal",
      ),
    ).toBeUndefined();
  });
});

describe("open redirect", () => {
  it.each([
    ["src/routes.ts", "res.redirect(req.query.next);"],
    ["src/routes.ts", "res.redirect(302, req.query.returnTo);"],
    ["app/views.py", "return redirect(request.args['next'])"],
    ["app/sessions.rb", "redirect_to params[:return_to]"],
  ])("flags a redirect target from the request", (file, body) => {
    expect(byFix({ [file]: body }, "security-open-redirect")).toBeDefined();
  });

  it("does not flag a fixed destination", () => {
    expect(
      byFix({ "src/routes.ts": 'res.redirect("/dashboard");' }, "security-open-redirect"),
    ).toBeUndefined();
  });
});

describe("NoSQL injection", () => {
  it("flags a query taking the request body directly", () => {
    expect(
      byFix(
        { "src/login.ts": "const user = await User.findOne(req.body);" },
        "security-nosql-injection",
      ),
    ).toBeDefined();
  });

  /**
   * A quote *inside* the template literal must not end the match — that is the common shape,
   * since the injected value is usually being quoted into a JS expression.
   */
  it("flags $where with interpolation, quotes inside the template included", () => {
    expect(
      byFix(
        { "src/q.ts": "db.users.find({ $where: `this.name === '${name}'` })" },
        "security-nosql-injection",
      ),
    ).toBeDefined();
  });

  it("flags $where built by concatenation", () => {
    expect(
      byFix(
        { "src/q.ts": "db.users.find({ $where: 'this.name === ' + name })" },
        "security-nosql-injection",
      ),
    ).toBeDefined();
  });

  /** Reading named fields is the fix, so the fixed shape must not keep firing. */
  it("does not flag named fields pulled out of the body", () => {
    expect(
      byFix(
        { "src/login.ts": "const user = await User.findOne({ email: String(req.body.email) });" },
        "security-nosql-injection",
      ),
    ).toBeUndefined();
  });
});

describe("scope", () => {
  it("ignores test and fixture files, which hold deliberately bad code", () => {
    const bad = "const t = new https.Agent({ rejectUnauthorized: false });";
    expect(run({ "src/auth.test.ts": bad })).toEqual([]);
    expect(run({ "fixtures/insecure/app.ts": bad })).toEqual([]);
    expect(run({ "tests/helpers.ts": bad })).toEqual([]);
  });

  it("reports nothing for clean code", () => {
    expect(
      run({
        "src/app.ts": `import crypto from "node:crypto";
export const token = () => crypto.randomUUID();
export const redirectHome = (res: Response) => res.redirect("/");
`,
      }),
    ).toEqual([]);
  });

  it("names the line so the finding can be acted on", () => {
    const found = byFix(
      { "src/http.ts": "// header\n\nconst a = new https.Agent({ rejectUnauthorized: false });" },
      "security-tls-verification",
    );
    expect(found!.foundEvidence).toContain("src/http.ts:3");
  });
});
