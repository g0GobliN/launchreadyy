/**
 * Insecure CORS *configuration*.
 *
 * The stack-profile `corsDetector` only answers "is CORS configured at all" — for Express it
 * passes on `Boolean(deps["cors"])`, i.e. merely having the package installed. So a repo that
 * configures CORS badly scores as if it configured CORS well, which is the worse of the two
 * failures: the user is told this area is fine.
 *
 * The specific pairing checked here is a wildcard origin together with credentials. A browser
 * refuses `Access-Control-Allow-Origin: *` alongside credentials, so frameworks reflect the
 * caller's own origin back instead — which means any site can issue credentialed cross-origin
 * requests. Matching what `cors.ts` already tells users to avoid.
 */

import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

interface PermissivePattern {
  label: string;
  /** Both must match within the same file for the pairing to be real. */
  wildcard: RegExp;
  credentials: RegExp;
}

// The wildcard side matches anywhere on the assignment's line rather than immediately after the
// `=`. Real code rarely writes the literal directly: the shape that prompted this rule was
// `allow_origins=ALLOWED_ORIGINS if "*" not in ALLOWED_ORIGINS else ["*"]`, which an
// anchored pattern walks straight past.
const PATTERNS: PermissivePattern[] = [
  {
    label: "FastAPI CORSMiddleware",
    wildcard: /allow_origins\s*=[^\n]*["']\*["']/,
    credentials: /allow_credentials\s*=\s*True\b/,
  },
  {
    // Origins read from an env var that defaults to "*", with credentials unconditionally on.
    label: "FastAPI CORSMiddleware with a wildcard default",
    wildcard: /getenv\(\s*["'][^"']*ORIGIN[^"']*["']\s*,\s*["']\*["']/i,
    credentials: /allow_credentials\s*=\s*True\b/,
  },
  {
    label: "flask-cors",
    wildcard: /origins\s*=[^\n]*["']\*["']/,
    credentials: /supports_credentials\s*=\s*True\b/,
  },
  {
    label: "Express cors()",
    wildcard: /origin\s*:[^\n]*["']\*["']|origin\s*:\s*true\b/,
    credentials: /credentials\s*:\s*true\b/,
  },
  {
    label: "manual CORS headers",
    wildcard: /["']Access-Control-Allow-Origin["']\s*[,:=]\s*["']\*["']/i,
    credentials: /["']Access-Control-Allow-Credentials["']\s*[,:=]\s*["']?true["']?/i,
  },
];

const CHECKED_FOR = [
  "wildcard origin combined with credentials (FastAPI, flask-cors, Express cors(), manual headers)",
  "up to ~40 sampled source files (not the full repo tree)",
];

export function checkPermissiveCors(fileContents: Record<string, string>, issues: IssueInput[]) {
  const hits: string[] = [];
  const signals: Signal[] = [];

  for (const [file, content] of Object.entries(fileContents)) {
    if (!content) continue;
    for (const { label, wildcard, credentials } of PATTERNS) {
      if (wildcard.test(content) && credentials.test(content)) {
        hits.push(`${label} in ${file}`);
        signals.push({ kind: "exact_match", detail: `${label} in ${file}` });
        break; // one finding per file is enough to flag it
      }
    }
  }

  if (hits.length === 0) return;

  const shown = hits.slice(0, 5);
  const more = hits.length > shown.length ? ` +${hits.length - shown.length} more.` : "";

  issues.push({
    category: "Security",
    title: `CORS allows any origin with credentials (${hits.length} found)`,
    severity: "high",
    why: "A wildcard origin cannot be combined with credentials, so the framework reflects the caller's origin back instead. Any website a logged-in user visits can then make authenticated cross-origin requests to this API and read the response.",
    timeSaved: "45m",
    fixId: "security-cors-permissive",
    checkedFor: CHECKED_FOR,
    foundEvidence: `Found: ${shown.join("; ")}.${more}`,
    confidence: confidenceFromSignals(signals),
    detection: ["rule-based"],
    recommendedFix:
      "Replace the wildcard with an explicit list of production origins, or turn credentials off. Credentials are only safe alongside origins you name.",
  });
}
