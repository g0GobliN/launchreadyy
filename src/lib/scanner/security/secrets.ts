import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

/**
 * Hardcoded secret detection over sampled file contents. Two tiers:
 *
 * 1. Provider-prefixed keys (AWS AKIA…, Stripe sk_live_…, GitHub ghp_…) — the prefix is the
 *    provider's own namespace, so a match is hard evidence: Critical, high confidence.
 * 2. Generic `api_key = "…"` assignments passing an entropy gate — heuristic, can false-positive
 *    on fixtures and placeholders: High severity, medium confidence (never Critical, per the
 *    severity-calibration rule).
 *
 * Matched values are always redacted in evidence — we name the leak, never republish it.
 * Content checks see only the auditor's ~40-file sample (disclosed in checkedFor).
 */

interface ProviderPattern {
  name: string;
  regex: RegExp;
  /**
   * Which capture group holds the credential, when the pattern has to match surrounding context
   * to be evidence at all. Defaults to the whole match.
   */
  valueGroup?: number;
  /**
   * `scheme://user:pass@host` — the one shape here that is not a vendor namespace, so it needs
   * the dev-credential guard below. See {@link isDevConnectionUri}.
   */
  connectionUri?: true;
}

/**
 * Order matters: more specific prefixes first (sk-ant- before the generic sk- OpenAI shape), and
 * each matched substring is claimed once so later patterns can't double-report it.
 *
 * Every entry here is a provider's *own* namespace — a vendor-assigned prefix plus a fixed body
 * length. That is what earns these Critical severity and high confidence: `AKIA…` is not a string
 * that occurs by chance, so a match is evidence rather than suspicion. A pattern that cannot make
 * that claim belongs in the generic entropy tier below, not in this list.
 *
 * Scope: the credentials a launching product actually holds — cloud, payments, AI providers,
 * auth, email, databases, CI. Breadth here is the cheapest detection we have, because the
 * whole-repo sweep already reads the files.
 */
const PROVIDER_PATTERNS: ProviderPattern[] = [
  // ---- Cloud ----
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "AWS temporary access key", regex: /\bASIA[0-9A-Z]{16}\b/g },
  { name: "Google Cloud service account key", regex: /"type":\s*"service_account"/g },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Google OAuth client secret", regex: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g },
  { name: "Azure storage account key", regex: /\bAccountKey=[A-Za-z0-9+/]{86}==/g },
  { name: "DigitalOcean personal access token", regex: /\bdop_v1_[a-f0-9]{64}\b/g },
  { name: "Cloudflare API token", regex: /\bv1\.0-[a-f0-9]{24}-[a-f0-9]{146}\b/g },

  // ---- Payments ----
  // Stripe and Clerk both issue `sk_live_…`, so the prefix cannot tell them apart. The finding
  // is the same either way — a live secret key is committed — and naming one vendor would be a
  // coin flip presented as evidence.
  { name: "Stripe or Clerk live secret key", regex: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g },
  { name: "Stripe webhook signing secret", regex: /\bwhsec_[A-Za-z0-9]{32,}\b/g },
  { name: "PayPal client secret", regex: /\bE[A-Za-z0-9_-]{7}-[A-Za-z0-9_-]{72}\b/g },
  { name: "Square access token", regex: /\bsq0(?:atp|csp)-[A-Za-z0-9_-]{22,}\b/g },

  // ---- AI providers ----
  { name: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "OpenAI API key", regex: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: "Hugging Face token", regex: /\bhf_[A-Za-z0-9]{34}\b/g },
  { name: "Groq API key", regex: /\bgsk_[A-Za-z0-9]{52}\b/g },
  { name: "Replicate API token", regex: /\br8_[A-Za-z0-9]{37}\b/g },

  // ---- Source control & CI ----
  { name: "GitHub fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "GitLab personal access token", regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { name: "npm token", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "PyPI upload token", regex: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}\b/g },
  { name: "Vercel API token", regex: /\bvercel_[A-Za-z0-9]{24,}\b/g },
  { name: "Netlify access token", regex: /\bnfp_[A-Za-z0-9]{36,}\b/g },

  // ---- Auth, backend & data ----
  { name: "Supabase service role key", regex: /\bsbp_[a-f0-9]{40}\b/g },
  {
    name: "Firebase Cloud Messaging server key",
    regex: /\bAAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140,}\b/g,
  },
  {
    name: "Postgres connection URI with password",
    regex: /\bpostgres(?:ql)?:\/\/[^:@\s/]+:[^@\s/]{6,}@/g,
    connectionUri: true,
  },
  {
    name: "MongoDB connection URI with password",
    regex: /\bmongodb(?:\+srv)?:\/\/[^:@\s/]+:[^@\s/]{6,}@/g,
    connectionUri: true,
  },
  {
    name: "MySQL connection URI with password",
    regex: /\bmysql:\/\/[^:@\s/]+:[^@\s/]{6,}@/g,
    connectionUri: true,
  },
  {
    name: "Redis connection URI with password",
    regex: /\bredis(?:s)?:\/\/[^:@\s/]*:[^@\s/]{6,}@/g,
    connectionUri: true,
  },

  // ---- Messaging & email ----
  { name: "Slack token", regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  {
    name: "Slack webhook URL",
    regex:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9]{20,}/g,
  },
  {
    name: "Discord bot token",
    regex: /\b[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
  },
  { name: "SendGrid API key", regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { name: "Mailgun API key", regex: /\bkey-[a-f0-9]{32}\b/g },
  {
    name: "Postmark server token",
    regex: /\bPOSTMARK_[A-Z_]*=?["']?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g,
  },
  { name: "Twilio account SID", regex: /\bAC[a-f0-9]{32}\b/g },
  { name: "Twilio API key", regex: /\bSK[a-f0-9]{32}\b/g },

  // ---- Monitoring ----
  { name: "Sentry auth token", regex: /\bsntry[su]_[a-f0-9]{64}\b/g },
  // Datadog issues a plain 32-hex key with no namespace of its own, so the value alone is
  // indistinguishable from a git SHA — the unqualified pattern reported every SHA-pinned GitHub
  // Action as a leaked key, which is the pinning our own workflow rule asks for. The variable
  // name is what turns the value into evidence, so require it.
  {
    name: "Datadog API key",
    regex: /\b(?:dd|datadog)[_-]?(?:api|app)[_-]?key["']?\s*[:=]\s*["']?([a-f0-9]{32})\b/gi,
    valueGroup: 1,
  },

  // ---- Generic key material ----
  {
    name: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
];

const GENERIC_ASSIGNMENT =
  /(?:api[_-]?key|apikey|secret|token|passwd|password)["']?\s*[:=]\s*["']([A-Za-z0-9+/_=-]{20,})["']/gi;

// Docs, lockfiles, env templates, and tests are full of example / fixture keys.
// The naming conventions cover every language we scan, not just JS: `user_test.go`,
// `test_auth.py`, `AuthTest.java` and `src/test/` hold fixture credentials exactly as
// `auth.test.ts` does, and reporting those as leaked keys is a false launch blocker.
const SKIP_FILE =
  /\.(md|mdx|lock|min\.js|map|svg)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|(^|\/)\.env\.(example|sample|template)$|(^|\/)(fixtures?|__tests?__|e2e|tests?|spec)\/|(^|\/)src\/test\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb|exs?|dart)$|(^|\/)test_[^/]+\.py$|(^|\/)[^/]+_spec\.rb$|Tests?\.(java|kt|cs|swift)$/i;

/**
 * Rust (and Zig, and Go with build tags) keep unit tests *inside* the production source file,
 * behind `#[cfg(test)]`. Path-based skipping cannot see them, so a fixture key in a test module
 * was reported as a hardcoded production credential — a critical blocker for a string that never
 * ships. Returns the [start, end) character ranges occupied by such modules.
 */
export function inFileTestRegions(file: string, content: string): Array<[number, number]> {
  if (!/\.rs$/i.test(file)) return [];
  const regions: Array<[number, number]> = [];
  const attribute = /#\[cfg\(test\)\]/g;
  for (const match of content.matchAll(attribute)) {
    const from = match.index ?? 0;
    const open = content.indexOf("{", from);
    if (open === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    regions.push([from, end === -1 ? content.length : end]);
  }
  return regions;
}

function isInsideTestRegion(regions: Array<[number, number]>, index: number): boolean {
  return regions.some(([from, to]) => index >= from && index < to);
}

const PLACEHOLDER =
  /example|your[_-]|placeholder|change[_-]?me|dummy|sample|insert|replace|redacted|xxxx|\*\*\*\*|<[^>]*>|\$\{|%s/i;

/**
 * `uses: owner/repo@<sha>` is a pinned GitHub Action, and pinning by SHA is exactly what our own
 * `workflow-unpinned-action` rule asks people to do. A hex value on that line is a commit id, so
 * flagging it as a credential punishes the reader for taking our advice.
 */
const ACTION_PIN_LINE = /^\s*(?:-\s*)?uses:\s*\S+@[0-9a-f]{7,40}\b/;

/** `$VAR`, `${VAR}`, `%(name)s`, `{{ var }}` — a template hole, not a credential. */
const INTERPOLATION = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%\([A-Za-z_]*\)?[sd]|%s|\{\{[^}]*\}\}/;

/**
 * Throwaway pairs that ship in CI service containers, docker-compose files and quickstart
 * READMEs. None of them protects anything; every one of them appears in repos that have no leak.
 */
const DEV_CREDENTIAL_PAIRS = new Set([
  "postgres:postgres",
  "postgres:password",
  "postgres:postgres_password",
  "root:root",
  "root:password",
  "root:example",
  "root:secret",
  "mysql:mysql",
  "admin:admin",
  "admin:password",
  "user:password",
  "guest:guest",
  "test:test",
  "dev:dev",
  "mongo:mongo",
  "redis:redis",
  "rails:rails",
  "docker:docker",
]);

/**
 * A connection URI is the one provider pattern whose match is not a vendor namespace: the shape
 * `scheme://user:pass@` occurs constantly in CI configs and quickstart docs, where the password
 * is a throwaway local one. A false Critical there costs the whole report its credibility, so two
 * shapes are suppressed — and only these two:
 *
 *   1. **Interpolation.** `postgres://$USER:$PASSWORD@$HOST` contains no credential at all.
 *   2. **A dev pair on a host that is not reachable.** `postgres:postgres@localhost`, or the
 *      user repeated as the password (`conduit:conduit@db`), where the host has no dot and so
 *      can only be a loopback alias or a compose service name.
 *
 * Anything else stays Critical. A strong password, or any host that resolves off the machine, is
 * treated as a real leak even when the user looks generic — the safe direction to be wrong in.
 *
 * @param match the matched `scheme://user:pass@` prefix
 * @param rest  the text immediately after the `@`, which is where the host lives
 */
export function isDevConnectionUri(match: string, rest: string): boolean {
  const creds = match.slice(match.indexOf("://") + 3, -1);
  const sep = creds.indexOf(":");
  if (sep < 0) return false;
  const user = creds.slice(0, sep);
  const pass = creds.slice(sep + 1);

  if (INTERPOLATION.test(creds)) return true;

  const knownPair = DEV_CREDENTIAL_PAIRS.has(`${user.toLowerCase()}:${pass.toLowerCase()}`);
  const userIsPassword = user.length > 0 && user.toLowerCase() === pass.toLowerCase();
  if (!knownPair && !userIsPassword) return false;

  const host = (rest.match(/^\[?([^\]/\s"'`,;)]+)\]?/)?.[1] ?? "").replace(/:\d+$/, "");
  if (!host) return false;
  if (INTERPOLATION.test(host)) return true;
  const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);
  // No dot means no public DNS name: a container service name, a compose alias, or a hosts entry.
  return LOOPBACK.has(host.toLowerCase()) || !host.includes(".");
}

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function lineText(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1;
  const end = content.indexOf("\n", index);
  return content.slice(start, end === -1 ? content.length : end);
}

function redact(value: string): string {
  return `${value.slice(0, 6)}… (${value.length} chars)`;
}

interface SecretHit {
  file: string;
  line: number;
  label: string;
}

function formatEvidence(hits: SecretHit[]): string {
  const shown = hits.slice(0, 5).map((h) => `${h.label} in ${h.file}:${h.line}`);
  const more = hits.length > 5 ? ` +${hits.length - 5} more.` : "";
  return `Found: ${shown.join("; ")}.${more}`;
}

const CHECKED_PATTERNS = [
  // Generated from the table above so the disclosure cannot drift from what actually ran — the
  // user is told the count, and the four named groups say what kind of thing is covered.
  `${PROVIDER_PATTERNS.length} provider key formats (cloud, payments, AI, source control, auth, database URIs, messaging, monitoring)`,
  "private key blocks",
  "database connection strings with an inline password",
  "high-entropy api_key/secret/token/password literals",
];

/** What the fast tier can honestly claim — one GitHub read per file caps how many it sees. */
export const SAMPLED_SCOPE_NOTE = "up to ~40 sampled source files (not the full repo tree)";

export interface SecretCheckOptions {
  /**
   * How much of the repository these contents represent. The deep tier greps the whole checkout,
   * so it passes a different note rather than repeating the fast tier's sampling caveat.
   */
  scopeNote?: string;
}

export function checkHardcodedSecrets(
  fileContents: Record<string, string>,
  issues: IssueInput[],
  opts: SecretCheckOptions = {},
) {
  const CHECKED_FOR = [...CHECKED_PATTERNS, opts.scopeNote ?? SAMPLED_SCOPE_NOTE];
  const providerHits: SecretHit[] = [];
  const heuristicHits: SecretHit[] = [];
  const providerSignals: Signal[] = [];
  const heuristicSignals: Signal[] = [];

  for (const [file, content] of Object.entries(fileContents)) {
    if (SKIP_FILE.test(file) || !content) continue;
    const claimed = new Set<string>();
    const testRegions = inFileTestRegions(file, content);

    for (const { name, regex, valueGroup, connectionUri } of PROVIDER_PATTERNS) {
      regex.lastIndex = 0;
      for (const m of content.matchAll(regex)) {
        const value = valueGroup === undefined ? m[0] : (m[valueGroup] ?? m[0]);
        const at = m.index ?? 0;
        if (claimed.has(value)) continue;
        const line = lineText(content, at);
        if (PLACEHOLDER.test(line)) continue;
        if (ACTION_PIN_LINE.test(line) && /^[0-9a-f]+$/i.test(value)) continue;
        if (connectionUri && isDevConnectionUri(m[0], content.slice(at + m[0].length, at + 200)))
          continue;
        if (isInsideTestRegion(testRegions, at)) continue;
        claimed.add(value);
        const label = name === "Private key block" ? name : `${name} ("${redact(value)}")`;
        const hit = { file, line: lineOf(content, at), label };
        providerHits.push(hit);
        providerSignals.push({
          kind: "provider_prefix",
          detail: `${name} in ${hit.file}:${hit.line}`,
        });
      }
    }

    GENERIC_ASSIGNMENT.lastIndex = 0;
    for (const m of content.matchAll(GENERIC_ASSIGNMENT)) {
      const value = m[1]!;
      if (claimed.has(value) || [...claimed].some((c) => value.includes(c) || c.includes(value)))
        continue;
      const line = lineText(content, m.index ?? 0);
      if (PLACEHOLDER.test(line) || /process\.env|os\.environ|import\.meta\.env/.test(line))
        continue;
      if (isInsideTestRegion(testRegions, m.index ?? 0)) continue;
      if (shannonEntropy(value) < 3.5) continue;
      claimed.add(value);
      const hit = {
        file,
        line: lineOf(content, m.index ?? 0),
        label: `credential-like literal ("${redact(value)}")`,
      };
      heuristicHits.push(hit);
      heuristicSignals.push({
        kind: "heuristic",
        detail: `high-entropy assignment in ${hit.file}:${hit.line}`,
      });
    }
  }

  if (providerHits.length > 0) {
    issues.push({
      category: "Security",
      title: `Hardcoded API keys in source code (${providerHits.length} found)`,
      severity: "critical",
      why: "A provider-issued key is written directly into a source file. Anyone with repo access can use it, and it stays recoverable from git history even after the line is deleted.",
      timeSaved: "4h",
      fixId: "security-hardcoded-secret",
      checkedFor: CHECKED_FOR,
      foundEvidence: formatEvidence(providerHits),
      confidence: confidenceFromSignals(providerSignals),
      detection: ["rule-based"],
      recommendedFix:
        "Rotate each exposed key with its provider now, then load it from an environment variable. Deleting the line is not enough — the key remains in git history.",
    });
  }

  if (heuristicHits.length > 0) {
    issues.push({
      category: "Security",
      title: `Possible hardcoded credentials (${heuristicHits.length} found)`,
      severity: "high",
      why: "A high-entropy value is assigned to a key/secret/password-named variable. If it's a real credential, it's readable by anyone with repo access and preserved in git history.",
      timeSaved: "2h",
      fixId: "security-secret-heuristic",
      checkedFor: CHECKED_FOR,
      foundEvidence: formatEvidence(heuristicHits),
      confidence: confidenceFromSignals(heuristicSignals),
      detection: ["rule-based"],
      recommendedFix:
        "Check each flagged value. If it's a real credential, rotate it and move it to an environment variable; if it's a fixture, rename it or mark it clearly as a placeholder.",
    });
  }
}
