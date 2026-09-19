import { describe, expect, it } from "vitest";
import type { IssueInput } from "../../scanner-rules";
import { checkCommittedSecrets, checkEnvExample } from "./env-hygiene";
import { checkDependencyAudit } from "./dependency-audit";
import {
  confidenceFromSignals,
  runSecurityChecks,
  runStackProfileChecks,
  runPatternSecurityChecks,
} from "./index";
import { checkHardcodedSecrets } from "./secrets";
import { checkUnsafeApis } from "./unsafe-apis";

describe("checkHardcodedSecrets — provider detection", () => {
  it("aggregates provider keys into one critical high-confidence issue", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        "src/config.ts": [
          'const aws = "AKIAIOSFODNN7SECRET1";', // gitleaks:allow
          'const stripe = "sk_live_abcdefghijklmnopqrstuvwxyz";',
          'const gh = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
          "-----BEGIN RSA PRIVATE KEY-----", // gitleaks:allow
          "MIIEowIBAAKCAQEA...",
          "-----END RSA PRIVATE KEY-----",
        ].join("\n"),
      },
      issues,
    );

    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.severity).toBe("critical");
    expect(issue.confidence).toBe("high");
    expect(issue.fixId).toBe("security-hardcoded-secret");
    expect(issue.title).toMatch(/4 found/);
    expect(issue.checkedFor?.some((c) => c.includes("sampled"))).toBe(true);
  });

  it("redacts the full key from foundEvidence", () => {
    const fullKey = "sk_live_abcdefghijklmnopqrstuvwxyz";
    const issues: IssueInput[] = [];
    checkHardcodedSecrets({ "a.ts": `const k = "${fullKey}";` }, issues);

    expect(issues[0]?.foundEvidence).toBeDefined();
    expect(issues[0]!.foundEvidence).not.toContain(fullKey);
    expect(issues[0]!.foundEvidence).toContain("sk_liv…");
  });

  it("skips placeholder / example keys", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      { "docs/keys.ts": 'const aws = "AKIAIOSFODNN7EXAMPLE"; // EXAMPLE from AWS docs' },
      issues,
    );
    expect(issues).toHaveLength(0);
  });

  it("skips .md and lockfiles", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        "README.md": "aws key AKIAIOSFODNN7SECRET1", // gitleaks:allow
        "package-lock.json": '"sk_live_abcdefghijklmnopqrstuvwxyz"',
      },
      issues,
    );
    expect(issues).toHaveLength(0);
  });

  it("skips test files in every language we scan, not just JavaScript", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        "internal/auth/session_test.go": 'key := "sk_live_abcdefghijklmnopqrstuvwxyz01"',
        "api/test_billing.py": 'KEY = "sk_live_bcdefghijklmnopqrstuvwxyz012"', // gitleaks:allow
        "spec/models/user_spec.rb": 'key = "sk_live_cdefghijklmnopqrstuvwxyz0123"', // gitleaks:allow
        "src/test/java/BillingTest.java": 'String k = "sk_live_defghijklmnopqrstuvwxyz01234";', // gitleaks:allow
      },
      issues,
    );
    expect(issues).toHaveLength(0);
  });

  it("skips a Rust #[cfg(test)] module, whose fixtures live inside the source file", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        "src/secrets.rs": `
          pub fn sweep(content: &str) -> Vec<Hit> { detect(content) }

          #[cfg(test)]
          mod tests {
              #[test]
              fn caps_per_file() {
                  let line = "token sk_live_abcdefghijklmnopqrstuvwxyz0123456789";
              }
          }
        `,
      },
      issues,
    );
    expect(issues).toHaveLength(0);
  });

  it("still flags a key in the production half of a Rust file", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        "src/client.rs": `
          const STRIPE: &str = "sk_live_abcdefghijklmnopqrstuvwxyz0123456789";

          #[cfg(test)]
          mod tests {
              #[test]
              fn noop() {}
          }
        `,
      },
      issues,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("critical");
  });
});

/**
 * Both shapes below were found reporting a **critical** leak on real, clean upstream repositories
 * after the provider patterns were widened. A false Critical is the most expensive finding the
 * product can produce — it is the one that costs the report its credibility — so each shape gets
 * a test, paired with the true positive it must not weaken.
 */
describe("checkHardcodedSecrets — false positives on real repos", () => {
  it("does not read a SHA-pinned GitHub Action as a Datadog key", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        ".github/workflows/changelog.yml":
          "    uses: laravel/.github/.github/workflows/update-changelog.yml@dd86ce0a18475504e42fa809d7454c1cb1a88028 # main",
      },
      issues,
    );
    expect(issues).toHaveLength(0);
  });

  it("still flags a Datadog key that names itself", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      { "src/monitoring.ts": 'DD_API_KEY = "dd86ce0a18475504e42fa809d7454c1b"' }, // gitleaks:allow
      issues,
    );
    expect(issues[0]?.foundEvidence).toContain("Datadog API key");
  });

  it("does not flag a connection URI built from shell variables", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        "scripts/env.sh":
          "echo DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:5432/$POSTGRES_DB >> .env",
      },
      issues,
    );
    expect(issues).toHaveLength(0);
  });

  it.each([
    ["CI service container", "postgresql://postgres:postgres@localhost/postgres"],
    ["docker-compose service name", "postgresql://postgres:postgres@db/postgres"],
    ["quickstart README", "postgresql://postgres:postgres@0.0.0.0:5432/rwdb"],
    ["user repeated as password", "postgres://conduit:conduit@db:5432/conduit"],
    ["mysql root/root", "mysql://root:root@127.0.0.1:3306/app"],
  ])("does not flag a throwaway dev database URI — %s", (_label, uri) => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets({ "docker-compose.yml": `      DATABASE_URL: "${uri}"` }, issues);
    expect(issues).toHaveLength(0);
  });

  it.each([
    ["strong password on a real host", "postgresql://appuser:Xk9fQ2rLm4Tz@db.acmeprod.io:5432/app"],
    ["dev-looking user, real host", "postgresql://postgres:postgres@prod.eu-west-1.rds.aws.com/db"],
    ["strong password on localhost", "postgresql://appuser:Xk9fQ2rLm4Tz@localhost:5432/app"],
  ])("still flags a real connection string — %s", (_label, uri) => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets({ "src/db.py": `DB = "${uri}"` }, issues);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("critical");
  });
});

describe("checkHardcodedSecrets — entropy heuristic", () => {
  it("flags high-entropy apiKey assignment as high / medium confidence", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets({ "src/a.ts": 'const apiKey = "xK9mP2qR7vN4wL8sT1uY6zA3";' }, issues); // gitleaks:allow

    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("high");
    expect(issues[0]!.confidence).toBe("medium");
    expect(issues[0]!.fixId).toBe("security-secret-heuristic");
  });

  it("skips low-entropy values", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets({ "src/a.ts": 'const apiKey = "aaaaaaaaaaaaaaaaaaaa";' }, issues);
    expect(issues).toHaveLength(0);
  });

  it("skips process.env lines", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      {
        "src/a.ts": 'const apiKey = "xK9mP2qR7vN4wL8sT1uY6zA3"; // mirrors process.env.API_KEY', // gitleaks:allow
      },
      issues,
    );
    expect(issues).toHaveLength(0);
  });

  it("does not double-report a provider match via the generic pass", () => {
    const issues: IssueInput[] = [];
    checkHardcodedSecrets(
      { "src/a.ts": 'const secret = "sk_live_abcdefghijklmnopqrstuvwxyz";' },
      issues,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("critical");
    expect(issues[0]!.fixId).toBe("security-hardcoded-secret");
  });
});

describe("env-hygiene", () => {
  it("flags committed .env and ignores allowlisted templates", () => {
    const issues: IssueInput[] = [];
    checkCommittedSecrets(
      [".env", ".env.local", ".env.example", ".env.sample", ".env.template", "src/index.ts"],
      issues,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]!.title).toContain(".env");
    expect(issues[0]!.title).toContain(".env.local");
    expect(issues[0]!.title).not.toContain(".env.example");
    expect(issues[0]!.severity).toBe("critical");
    expect(issues[0]!.confidence).toBe("high");
  });

  it("flags missing .env.example and stays quiet when present", () => {
    const missing: IssueInput[] = [];
    checkEnvExample(false, missing);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.confidence).toBe("high");

    const present: IssueInput[] = [];
    checkEnvExample(true, present);
    expect(present).toHaveLength(0);
  });
});

describe("checkUnsafeApis", () => {
  it("flags eval and marks user-adjacent as high", () => {
    const issues: IssueInput[] = [];
    checkUnsafeApis(
      {
        "src/run.ts": "eval(req.body.code);",
        "src/safe.ts": "const x = 1;",
      },
      issues,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("high");
    expect(issues[0]!.confidence).toBe("medium");
    expect(issues[0]!.fixId).toBe("security-unsafe-api");
  });

  it("uses medium severity when no user-input hint", () => {
    const issues: IssueInput[] = [];
    checkUnsafeApis({ "src/run.ts": 'eval("1+1");' }, issues);
    expect(issues[0]!.severity).toBe("medium");
  });
});

describe("confidenceFromSignals", () => {
  it("maps provider/exact to high and heuristic to medium", () => {
    expect(confidenceFromSignals([{ kind: "provider_prefix" }])).toBe("high");
    expect(confidenceFromSignals([{ kind: "exact_absence" }])).toBe("high");
    expect(confidenceFromSignals([{ kind: "heuristic" }])).toBe("medium");
    expect(confidenceFromSignals([{ kind: "pattern_only" }])).toBe("low");
  });
});

describe("checkDependencyAudit", () => {
  it("flags CI without audit and stays quiet when audit exists", () => {
    const missing: IssueInput[] = [];
    checkDependencyAudit(
      [".github/workflows/ci.yml"],
      { ".github/workflows/ci.yml": "name: CI\njobs:\n  test:\n    runs-on: ubuntu-latest\n" },
      missing,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]!.fixId).toBe("dependency-audit-ci");

    const present: IssueInput[] = [];
    checkDependencyAudit(
      [".github/workflows/ci.yml"],
      {
        ".github/workflows/ci.yml":
          "jobs:\n  security-audit:\n    steps:\n      - run: npm audit --audit-level=high\n",
      },
      present,
    );
    expect(present).toHaveLength(0);
  });
});

describe("runPatternSecurityChecks", () => {
  it("flags dangerouslySetInnerHTML and jwt.decode", () => {
    const issues: IssueInput[] = [];
    runPatternSecurityChecks(
      {
        "src/a.tsx": "return <div dangerouslySetInnerHTML={{ __html: html }} />;",
        "src/auth.ts": "const payload = jwt.decode(token);",
      },
      issues,
    );
    expect(issues.some((i) => i.fixId === "security-xss")).toBe(true);
    expect(issues.some((i) => i.fixId === "security-jwt")).toBe(true);
  });
});

describe("runStackProfileChecks", () => {
  it("flags Express session apps without CSRF", () => {
    const issues: IssueInput[] = [];
    runStackProfileChecks(
      {
        files: ["src/app.ts"],
        fileContents: {
          "src/app.ts":
            'const session = require("express-session"); app.use(session({ secret: "x" }));',
        },
        deps: { express: "4.18.0", "express-session": "1.17.0" },
        sourceContent: 'const express = require("express");',
      },
      issues,
    );
    expect(issues.some((i) => i.fixId === "security-csrf")).toBe(true);
  });
});

describe("runSecurityChecks orchestrator", () => {
  it("only runs envExample check when automatedFixSupported", () => {
    const withFix: IssueInput[] = [];
    runSecurityChecks(
      {
        files: ["src/a.ts"],
        fileContents: {},
        envExampleExists: false,
        automatedFixSupported: true,
        envExampleFixId: "env-example-ai",
      },
      withFix,
    );
    expect(withFix.some((i) => i.fixId === "env-example-ai")).toBe(true);

    const withoutFix: IssueInput[] = [];
    runSecurityChecks(
      {
        files: ["src/a.ts"],
        fileContents: {},
        envExampleExists: false,
        automatedFixSupported: false,
      },
      withoutFix,
    );
    expect(withoutFix.some((i) => i.fixId?.startsWith("env-example"))).toBe(false);
  });
});
