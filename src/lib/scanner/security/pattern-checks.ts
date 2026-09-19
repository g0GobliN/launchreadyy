import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

const SKIP = /\.(md|mdx|lock|min\.js|map|svg|test|spec)\.|__(tests|mocks)__|\.d\.ts$/i;

interface Hit {
  file: string;
  label: string;
}

function collect(
  fileContents: Record<string, string>,
  patterns: { label: string; re: RegExp; ext?: RegExp }[],
): Hit[] {
  const hits: Hit[] = [];
  for (const [file, content] of Object.entries(fileContents)) {
    if (SKIP.test(file) || !content) continue;
    for (const { label, re, ext } of patterns) {
      if (ext && !ext.test(file)) continue;
      re.lastIndex = 0;
      if (re.test(content)) hits.push({ file, label });
    }
  }
  return hits;
}

function pushAggregated(
  issues: IssueInput[],
  hits: Hit[],
  opts: {
    title: string;
    severity: IssueInput["severity"];
    why: string;
    fixId: string;
    checkedFor: string[];
    recommendedFix: string;
    signalKind?: Signal["kind"];
  },
) {
  if (hits.length === 0) return;
  const shown = hits
    .slice(0, 5)
    .map((h) => `${h.label} in ${h.file}`)
    .join("; ");
  const more = hits.length > 5 ? ` +${hits.length - 5} more.` : "";
  const signals: Signal[] = hits.map((h) => ({
    kind: opts.signalKind ?? "heuristic",
    detail: `${h.label} in ${h.file}`,
  }));
  issues.push({
    category: "Security",
    title: `${opts.title} (${hits.length} found)`,
    severity: opts.severity,
    why: opts.why,
    timeSaved: "1h",
    fixId: opts.fixId,
    checkedFor: [...opts.checkedFor, "up to ~40 sampled source files (not the full repo tree)"],
    foundEvidence: `Found: ${shown}.${more}`,
    confidence: confidenceFromSignals(signals),
    detection: ["rule-based"],
    recommendedFix: opts.recommendedFix,
  });
}

/** Unsafe JWT usage — algorithm none, hardcoded secrets, decode without verify. */
export function checkJwtPatterns(fileContents: Record<string, string>, issues: IssueInput[]) {
  pushAggregated(
    issues,
    collect(fileContents, [
      { label: "algorithm none", re: /algorithms?\s*:\s*\[\s*['"]none['"]/i },
      { label: "jwt.decode without verify", re: /\bjwt\.decode\s*\(/i },
      {
        label: "hardcoded JWT secret",
        re: /(?:jwt|jsonwebtoken).{0,80}(?:secret|SECRET)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      },
    ]),
    {
      title: "Unsafe JWT usage",
      severity: "high",
      why: "Weak JWT verification (alg=none, decode-without-verify, or hardcoded secrets) lets attackers forge sessions.",
      fixId: "security-jwt",
      checkedFor: ["algorithms: ['none']", "jwt.decode", "hardcoded JWT secrets"],
      recommendedFix:
        "Always verify signatures with an explicit algorithm allowlist; load secrets from env; never use alg=none in production.",
    },
  );
}

const XSS_PATTERNS: { label: string; regex: RegExp; ext?: RegExp }[] = [
  {
    label: "dangerouslySetInnerHTML",
    regex: /dangerouslySetInnerHTML/gi,
    ext: /\.(jsx|tsx|js|ts)$/i,
  },
  { label: "innerHTML assignment", regex: /\.innerHTML\s*=/gi, ext: /\.(js|ts|jsx|tsx)$/i },
  { label: "unescaped ERB", regex: /<%=\s*(?!.*html_escape)/gi, ext: /\.erb$/i },
  { label: "v-html", regex: /\bv-html\s*=/gi, ext: /\.(vue|js|ts)$/i },
];

/**
 * A dangerouslySetInnerHTML/innerHTML value that's a single quoted string literal with no
 * `${…}` interpolation is structurally incapable of carrying attacker-controlled data —
 * that's not a heuristic guess, it's a fact about what the surrounding source can contain
 * (e.g. a hardcoded inline theme-detection script). Anything else — a bare variable, a
 * function call, string concatenation, an interpolated template — *could* carry external
 * input and stays flagged, even when it's probably fine, because "probably" isn't provable
 * from source text alone.
 */
function isProvablyStatic(context: string): boolean {
  const htmlProp = /__html:\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/s.exec(context);
  if (htmlProp) return !htmlProp[2].includes("${");
  const assignment = /\.innerHTML\s*=\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1\s*[;,)]/s.exec(context);
  if (assignment) return !assignment[2].includes("${");
  return false;
}

/** XSS risk — dangerouslySetInnerHTML, unescaped templates. */
export function checkXssPatterns(fileContents: Record<string, string>, issues: IssueInput[]) {
  const hits: Array<{ file: string; label: string }> = [];

  for (const [file, content] of Object.entries(fileContents)) {
    if (SKIP.test(file) || !content) continue;
    for (const { label, regex, ext } of XSS_PATTERNS) {
      if (ext && !ext.test(file)) continue;
      regex.lastIndex = 0;
      for (const m of content.matchAll(regex)) {
        const start = m.index ?? 0;
        if (isProvablyStatic(content.slice(start, start + 400))) continue;
        hits.push({ file, label });
      }
    }
  }

  pushAggregated(issues, hits, {
    title: "XSS risk patterns",
    severity: "medium",
    why: "Unescaped HTML rendering can execute attacker-controlled scripts in your users' browsers.",
    fixId: "security-xss",
    checkedFor: ["dangerouslySetInnerHTML", "innerHTML", "v-html", "unescaped ERB"],
    recommendedFix:
      "Prefer text content or sanitized HTML (DOMPurify / framework escape helpers). Never render raw user input as HTML.",
  });
}

/** SSRF risk — user-controlled fetch/axios URLs. */
export function checkSsrfPatterns(fileContents: Record<string, string>, issues: IssueInput[]) {
  pushAggregated(
    issues,
    collect(fileContents, [
      {
        label: "fetch with req/query URL",
        re: /fetch\s*\(\s*(?:req\.(?:body|query|params)|request\.(?:json|url)|params\[)/i,
      },
      {
        label: "axios with user URL",
        re: /axios\.(?:get|post|put|patch|delete|request)\s*\(\s*(?:req\.|params)/i,
      },
      {
        label: "http.get with variable URL",
        re: /https?\.(?:get|request)\s*\(\s*(?:req\.|url|target)/i,
      },
    ]),
    {
      title: "SSRF risk patterns",
      severity: "high",
      why: "Server-side requests to user-controlled URLs can reach internal services, cloud metadata, or private networks.",
      fixId: "security-ssrf",
      checkedFor: ["fetch(req…)", "axios(req…)", "http.get with user input"],
      recommendedFix:
        "Allowlist outbound hosts; never pass raw user URLs to server-side fetch/axios without validation.",
      signalKind: "heuristic",
    },
  );
}

/** File upload without validation. */
export function checkUploadPatterns(fileContents: Record<string, string>, issues: IssueInput[]) {
  pushAggregated(
    issues,
    collect(fileContents, [
      { label: "multer without limits", re: /multer\s*\(\s*\)|multer\s*\(\s*\{\s*\}\s*\)/i },
      {
        label: "formidable/busboy upload",
        re: /\b(?:formidable|busboy|multipart\/form-data)\b/i,
      },
      { label: "Flask file save", re: /\.save\s*\(\s*.*request\.files/i, ext: /\.py$/i },
    ]),
    {
      title: "File upload without clear validation",
      severity: "medium",
      why: "Unvalidated uploads enable malware hosting, path traversal, and storage abuse.",
      fixId: "security-uploads",
      checkedFor: ["multer()", "formidable/busboy", "request.files save"],
      recommendedFix:
        "Enforce type allowlists, size limits, and random stored filenames; never serve uploads as executable content.",
    },
  );
}

/** SQL injection / raw query concatenation risk. */
export function checkInjectionPatterns(fileContents: Record<string, string>, issues: IssueInput[]) {
  pushAggregated(
    issues,
    collect(fileContents, [
      {
        label: "SQL string concat",
        re: /(?:query|execute|raw)\s*\(\s*[`"'].*(?:\$\{|\+|%\s*\()/i,
      },
      { label: "knex.raw concat", re: /\.raw\s*\(\s*[`"'].*\$\{/i },
      { label: "prisma.$queryRaw unsafe", re: /\$queryRaw(?:Unsafe)?\s*`[^`]*\$\{/i },
      {
        label: "f-string SQL",
        re: /(?:execute|cursor)\s*\(\s*f["'].*(?:SELECT|INSERT|UPDATE|DELETE)/i,
      },
    ]),
    {
      title: "SQL injection risk patterns",
      severity: "high",
      why: "String-built SQL lets attackers alter queries and read or destroy data.",
      fixId: "security-injection",
      checkedFor: ["string-concat SQL", "knex.raw", "$queryRaw with interpolation"],
      recommendedFix:
        "Use parameterized queries / ORM bind parameters. Never interpolate user input into SQL strings.",
    },
  );
}

export function runPatternSecurityChecks(
  fileContents: Record<string, string>,
  issues: IssueInput[],
) {
  checkJwtPatterns(fileContents, issues);
  checkXssPatterns(fileContents, issues);
  checkSsrfPatterns(fileContents, issues);
  checkUploadPatterns(fileContents, issues);
  checkInjectionPatterns(fileContents, issues);
}
