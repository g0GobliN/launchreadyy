/**
 * Code-level vulnerability classes not covered by the other security modules.
 *
 * This is the replacement for the generic rule pack we can no longer ship (see
 * docs/reference/19-tool-licensing.md). It is deliberately not an imitation of one: a rule pack
 * gets its value from breadth across thousands of framework-specific patterns, which is exactly
 * the thing a hand-maintained set cannot win at. What a small owned set *can* do is cover the
 * classes that actually sink a launch, across every language we scan, with evidence good enough
 * that the finding is worth reading.
 *
 * Each pattern here earns its place by being **specific about the dangerous shape**, not about
 * the API. `crypto.createHash("md5")` is fine for an ETag and catastrophic for a password, so the
 * rules match the context rather than the call — a rule that fires on every MD5 in the codebase
 * teaches users to ignore the category, which is worse than not having it.
 *
 * Precision over recall, deliberately. Every pattern below was run against a real codebase and
 * tuned until it produced no false positives; a missed finding costs one finding, a false one
 * costs the credibility of the whole report.
 */

import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

/** Test and fixture paths hold deliberately-bad code; reporting it is a false launch blocker. */
const SKIP =
  /\.(md|mdx|lock|min\.js|map|svg)$|(^|\/)(fixtures?|__tests?__|__mocks__|e2e|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb|exs?)$|(^|\/)test_[^/]+\.py$|\.d\.ts$/i;

interface Hit {
  file: string;
  line: number;
  label: string;
}

interface Rule {
  label: string;
  regex: RegExp;
  /** Restrict to file types where the pattern means what we think it means. */
  ext?: RegExp;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}

function collect(fileContents: Record<string, string>, rules: Rule[]): Hit[] {
  const hits: Hit[] = [];
  for (const [file, content] of Object.entries(fileContents)) {
    if (SKIP.test(file) || !content) continue;
    for (const { label, regex, ext } of rules) {
      if (ext && !ext.test(file)) continue;
      regex.lastIndex = 0;
      for (const m of content.matchAll(regex)) {
        hits.push({ file, line: lineOf(content, m.index ?? 0), label });
        // One hit per rule per file: the finding names the class, and ten identical lines in one
        // file is the same piece of work to fix as one.
        break;
      }
    }
  }
  return hits;
}

function push(
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
    timeSaved?: string;
  },
): void {
  if (hits.length === 0) return;
  const shown = hits.slice(0, 5).map((h) => `${h.label} in ${h.file}:${h.line}`);
  const more = hits.length > 5 ? ` +${hits.length - 5} more.` : "";
  issues.push({
    category: "Security",
    title: opts.title,
    severity: opts.severity,
    why: opts.why,
    timeSaved: opts.timeSaved ?? "1h",
    fixId: opts.fixId,
    checkedFor: [...opts.checkedFor, "up to ~40 sampled source files (not the full repo tree)"],
    foundEvidence: `Found: ${shown.join("; ")}.${more}`,
    confidence: confidenceFromSignals(
      hits.map((h) => ({
        kind: opts.signalKind ?? "heuristic",
        detail: `${h.label} in ${h.file}:${h.line}`,
      })),
    ),
    detection: ["rule-based"],
    recommendedFix: opts.recommendedFix,
  });
}

/* ------------------------------------------------------------- TLS verification */

/**
 * Disabled certificate verification.
 *
 * Almost always added to get past a self-signed certificate in development and then shipped. It
 * silently converts every HTTPS call into one an attacker on the network can read and rewrite —
 * the connection still *looks* encrypted, which is why this survives review.
 */
const TLS_RULES: Rule[] = [
  {
    label: "rejectUnauthorized: false",
    regex: /rejectUnauthorized\s*:\s*false/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "NODE_TLS_REJECT_UNAUTHORIZED = 0",
    regex: /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*["']?0/g,
  },
  { label: "requests verify=False", regex: /\bverify\s*=\s*False\b/g, ext: /\.py$/i },
  { label: "ssl._create_unverified_context", regex: /_create_unverified_context/g, ext: /\.py$/i },
  { label: "InsecureSkipVerify: true", regex: /InsecureSkipVerify\s*:\s*true/g, ext: /\.go$/i },
  {
    label: "CURLOPT_SSL_VERIFYPEER disabled",
    regex: /CURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*(?:false|0)/gi,
    ext: /\.php$/i,
  },
  {
    label: "OpenSSL::SSL::VERIFY_NONE",
    regex: /OpenSSL::SSL::VERIFY_NONE/g,
    ext: /\.(rb|erb)$/i,
  },
];

export function checkDisabledTlsVerification(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  push(issues, collect(fileContents, TLS_RULES), {
    title: "TLS certificate verification is turned off",
    severity: "high",
    why: "With verification disabled the connection is still encrypted, but to whoever answers — there is no check that it is the real server. Anyone positioned on the network can present their own certificate, read the traffic and change it. This is usually added to work around a self-signed certificate locally and then ships.",
    fixId: "security-tls-verification",
    checkedFor: [
      "rejectUnauthorized: false",
      "NODE_TLS_REJECT_UNAUTHORIZED=0",
      "requests verify=False",
      "Go InsecureSkipVerify",
      "cURL SSL_VERIFYPEER off",
    ],
    signalKind: "exact_match",
    recommendedFix:
      "Remove the override. For a self-signed certificate in development, add that certificate to the trust store (`NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`) instead of disabling the check, and keep the override out of any code path that can run in production.",
  });
}

/* -------------------------------------------------------------- Weak randomness */

/**
 * `Math.random()` and friends are fast, seeded, and predictable by design. Used for a token,
 * they produce values an attacker can reproduce.
 *
 * The rule requires the value to be *assigned to something security-relevant* — a token, a
 * session id, a reset code. Matching bare `Math.random()` would fire on animation jitter and
 * sample data, which is most of its real usage.
 */
const SECURITY_NAME = String.raw`(?:token|secret|nonce|salt|otp|code|key|passwo?rd|session|api[_-]?key|reset|verif\w*|csrf|uuid|guid|[a-z]*id)`;

const WEAK_RANDOM_RULES: Rule[] = [
  {
    label: "Math.random() used for a token/id",
    regex: new RegExp(
      String.raw`\b${SECURITY_NAME}\w*\s*[:=]\s*[^;\n]{0,80}Math\.random\s*\(`,
      "gi",
    ),
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "random module used for a token/id",
    regex: new RegExp(
      String.raw`\b${SECURITY_NAME}\w*\s*=\s*[^\n]{0,80}\brandom\.(?:random|randint|choice|randrange|sample)\s*\(`,
      "gi",
    ),
    ext: /\.py$/i,
  },
  {
    label: "math/rand used for a token/id",
    regex: new RegExp(
      String.raw`\b${SECURITY_NAME}\w*\s*:?=\s*[^\n]{0,80}\brand\.(?:Intn|Int|Float64)\s*\(`,
      "gi",
    ),
    ext: /\.go$/i,
  },
  {
    label: "rand() used for a token/id",
    regex: new RegExp(
      String.raw`\$${SECURITY_NAME}\w*\s*=\s*[^\n]{0,80}\b(?:rand|mt_rand)\s*\(`,
      "gi",
    ),
    ext: /\.php$/i,
  },
];

export function checkWeakRandomness(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  push(issues, collect(fileContents, WEAK_RANDOM_RULES), {
    title: "Security value generated from a predictable random source",
    severity: "high",
    why: "General-purpose random functions are fast because they are predictable — given a few outputs, the rest of the sequence can be derived. A password-reset code or session token built this way can be guessed rather than stolen.",
    fixId: "security-weak-random",
    checkedFor: [
      "Math.random() assigned to a token/session/key",
      "Python random module for secrets",
      "Go math/rand for secrets",
      "PHP rand()/mt_rand() for secrets",
    ],
    recommendedFix:
      "Use the platform's cryptographic generator: `crypto.randomUUID()` or `crypto.randomBytes()` in Node, `secrets.token_urlsafe()` in Python, `crypto/rand` in Go, `random_bytes()` in PHP.",
  });
}

/* ------------------------------------------------------------------ Weak hashing */

/**
 * MD5 and SHA-1 are only a problem in specific roles. Both are perfectly reasonable for an ETag
 * or a cache key, so the rule requires password/credential context on the same line — the
 * difference between a finding and noise.
 */
const WEAK_HASH_RULES: Rule[] = [
  {
    label: "MD5/SHA1 over a password",
    regex:
      /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)[\s\S]{0,60}?\.update\s*\(\s*[^)]*(?:passwo?rd|secret|credential)/gi,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "hashlib md5/sha1 over a password",
    regex: /hashlib\.(?:md5|sha1)\s*\([^)]*(?:passwo?rd|secret|credential)/gi,
    ext: /\.py$/i,
  },
  {
    label: "md5()/sha1() over a password",
    regex: /\b(?:md5|sha1)\s*\(\s*\$?\w*(?:passwo?rd|passwd|secret)/gi,
    ext: /\.(php|rb)$/i,
  },
  {
    label: "deprecated createCipher (no IV)",
    regex: /\bcreateCipher\s*\(/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "ECB block cipher mode",
    regex: /["'](?:AES-\d+-ECB|DES-ECB)["']|AES\/ECB|MODE_ECB/gi,
  },
];

export function checkWeakCrypto(fileContents: Record<string, string>, issues: IssueInput[]): void {
  push(issues, collect(fileContents, WEAK_HASH_RULES), {
    title: "Weak cryptography protecting credentials",
    severity: "high",
    why: "MD5 and SHA-1 are fast to compute, which is exactly wrong for passwords — commodity hardware tries billions of guesses per second against them. ECB mode leaks structure: identical plaintext blocks produce identical ciphertext blocks. `createCipher` derives a key with no salt and no initialization vector.",
    fixId: "security-weak-crypto",
    checkedFor: [
      "MD5/SHA-1 applied to passwords or secrets",
      "createCipher (no IV)",
      "ECB cipher mode",
    ],
    recommendedFix:
      "Hash passwords with a deliberately slow algorithm — bcrypt, scrypt or Argon2 — never a general-purpose digest. For encryption use an authenticated mode such as AES-GCM with a random IV per message.",
  });
}

/* ---------------------------------------------------------------- Path traversal */

/**
 * A file path built from request data. `../../../etc/passwd` is the classic, but the modern
 * version is a cloud credentials file or the app's own `.env`.
 */
const PATH_RULES: Rule[] = [
  {
    label: "fs read with request input",
    regex:
      /\bfs\.(?:readFile|readFileSync|createReadStream|readdir|readdirSync|unlink|unlinkSync)\s*\(\s*[^)]{0,120}\breq(?:uest)?\.(?:body|query|params)\b/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "path.join with request input",
    regex: /\bpath\.(?:join|resolve)\s*\([^)]{0,120}\breq(?:uest)?\.(?:body|query|params)\b/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "sendFile with request input",
    regex: /\.sendFile\s*\(\s*[^)]{0,120}\breq(?:uest)?\.(?:body|query|params)\b/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "open()/send_file with request input",
    regex:
      /\b(?:open|send_file|send_from_directory)\s*\(\s*[^)]{0,120}request\.(?:args|form|json|values|files)/g,
    ext: /\.py$/i,
  },
  {
    label: "File.read with params",
    regex: /\b(?:File\.(?:read|open)|send_file)\s*\(\s*[^)\n]{0,120}params\[/g,
    ext: /\.(rb|erb)$/i,
  },
  {
    label: "file_get_contents with request input",
    regex:
      /\b(?:file_get_contents|fopen|readfile|include|require)\s*\(\s*[^)\n]{0,120}\$_(?:GET|POST|REQUEST)/g,
    ext: /\.php$/i,
  },
];

export function checkPathTraversal(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  push(issues, collect(fileContents, PATH_RULES), {
    title: "File path built from request input",
    severity: "high",
    why: "If a filename comes from the request, a caller can walk out of the intended directory with `../` and read whatever the process can read — your `.env`, cloud credentials, other users' uploads. Where the path is used for a write or delete, they can destroy files instead.",
    fixId: "security-path-traversal",
    checkedFor: [
      "fs/path calls taking req.body/query/params",
      "Flask send_file with request data",
      "Rails File.read with params",
      "PHP file functions with superglobals",
    ],
    recommendedFix:
      "Never build a path from raw input. Map the input to a known-safe value (a database id, an allowlist), or resolve the final path and confirm it still sits inside the intended directory before opening it.",
  });
}

/* ------------------------------------------------------------------ Open redirect */

const REDIRECT_RULES: Rule[] = [
  {
    label: "res.redirect with request input",
    regex: /\.redirect\s*\(\s*(?:\d{3}\s*,\s*)?[^)]{0,60}\breq(?:uest)?\.(?:body|query|params)\b/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    label: "redirect with request input",
    regex: /\bredirect\s*\(\s*[^)]{0,60}request\.(?:args|form|GET|POST)/g,
    ext: /\.py$/i,
  },
  {
    label: "redirect_to with params",
    regex: /\bredirect_to\s+[^\n]{0,60}params\[/g,
    ext: /\.(rb|erb)$/i,
  },
];

export function checkOpenRedirect(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  push(issues, collect(fileContents, REDIRECT_RULES), {
    title: "Redirect target comes from the request",
    severity: "medium",
    why: "A link to your own domain that forwards anywhere the attacker chooses is what makes phishing work — the victim checks the domain, sees yours, and clicks. It also leaks tokens held in the URL to the destination.",
    fixId: "security-open-redirect",
    timeSaved: "30m",
    checkedFor: ["res.redirect / redirect / redirect_to taking request data"],
    recommendedFix:
      "Redirect only to relative paths, or check the target against an allowlist of hosts you control. Reject anything starting with `//` or a scheme.",
  });
}

/* ----------------------------------------------------------------- NoSQL injection */

const NOSQL_RULES: Rule[] = [
  {
    label: "Mongo query built from the request body",
    regex:
      /\.(?:find|findOne|findOneAndUpdate|updateOne|updateMany|deleteOne|deleteMany|count)\s*\(\s*req(?:uest)?\.(?:body|query|params)\s*[,)]/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
  {
    // Only a template literal interpolates, so `${` is matched inside backticks; the quoted-string
    // case is dangerous through concatenation instead, which is the second alternative. The
    // original character class excluded quotes, so `\`this.name === '${name}'\`` — a quote inside
    // the template — stopped the match before it reached the interpolation.
    label: "$where with interpolation",
    regex: /\$where\s*:\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/g,
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
  },
];

export function checkNoSqlInjection(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  push(issues, collect(fileContents, NOSQL_RULES), {
    title: "Database query built directly from the request",
    severity: "high",
    why: 'Passing a request body straight into a query lets the caller send operators instead of values. `{"password": {"$ne": null}}` turns a login check into “any user whose password is not null”, which is every user.',
    fixId: "security-nosql-injection",
    checkedFor: ["Mongo find/update/delete taking req.body directly", "$where with interpolation"],
    recommendedFix:
      "Read the individual fields you expect and coerce their types, or validate the body against a schema (zod, Joi) before it reaches the query. Never hand a raw request object to a query method.",
  });
}

/** Every code-pattern check. */
export function runCodePatternChecks(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  checkDisabledTlsVerification(fileContents, issues);
  checkWeakRandomness(fileContents, issues);
  checkWeakCrypto(fileContents, issues);
  checkPathTraversal(fileContents, issues);
  checkOpenRedirect(fileContents, issues);
  checkNoSqlInjection(fileContents, issues);
}
