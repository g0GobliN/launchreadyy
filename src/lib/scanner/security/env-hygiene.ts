import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals } from "./signals";

const COMMITTED_ENV_FILE = /^(\.env|\.env\.[\w.-]+)$/;
const ENV_FILE_ALLOWLIST = new Set([".env.example", ".env.sample", ".env.template"]);

/** Committed .env files ARE the leak — hard evidence, so Critical with high confidence. */
export function checkCommittedSecrets(files: string[], issues: IssueInput[]) {
  const leaked = files.filter(
    (f) => COMMITTED_ENV_FILE.test(f) && !ENV_FILE_ALLOWLIST.has(f.split("/").pop() ?? f),
  );
  if (leaked.length > 0) {
    issues.push({
      category: "Security",
      title: `Secrets committed to repo (${leaked.join(", ")})`,
      severity: "critical",
      why: "An env file with real credentials is sitting in git history, readable by anyone with repo access — and still recoverable from history even after deletion. Rotate every credential in it immediately; this fix only stops future commits.",
      timeSaved: "4h",
      fixId: "gitignore-env",
      checkedFor: [".env", ".env.*", "committed credential files"],
      foundEvidence: `Found: ${leaked.join(", ")} committed to git history.`,
      confidence: confidenceFromSignals(
        leaked.map((f) => ({ kind: "exact_match" as const, detail: f })),
      ),
      recommendedFix:
        "Rotate every credential in the committed file now, add it to .gitignore, and keep real values only in your deploy platform's secret store.",
    });
  }
}

export function checkEnvExample(envExists: boolean, issues: IssueInput[], fixId = "env-example") {
  if (!envExists) {
    const isAi = fixId === "env-example-ai";
    issues.push({
      category: "Security",
      title: isAi ? "Missing .env.example (AI-scanned fix available)" : "Missing .env.example",
      severity: "high",
      why: isAi
        ? "AI scans your codebase for env vars and writes a documented .env.example with descriptions."
        : "Without a documented env contract, onboarding and incident response slow down immediately. Teams end up reverse-engineering required variables from runtime errors.",
      timeSaved: "30m",
      fixId,
      checkedFor: [".env.example", ".env.sample", ".env.template"],
      foundEvidence: "No .env.example, .env.sample, or .env.template found in the repo tree.",
      confidence: confidenceFromSignals([{ kind: "exact_absence", detail: ".env.example" }]),
      recommendedFix:
        "Add a .env.example listing every required variable with placeholder values, so deploys and teammates can configure the app without guessing.",
    });
  }
}
