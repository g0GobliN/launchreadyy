/**
 * Regression cover for the subdirectory-app class of scan bugs.
 *
 * The original failure: an app living in a subdirectory (every monorepo, and the very common
 * `backend/` + `frontend/` split) detected as framework "unknown", which selected the Node
 * source-extension filter, which matched no files, which left every content-based Production
 * Security check scanning an empty set. Hardcoded credentials in `backend/app/main.py` produced
 * zero findings and a *higher* score than the identical file at the repository root.
 *
 * These tests pin the observable product behaviour, not the internals: same secret, same verdict,
 * wherever it lives.
 */
import { describe, it, expect } from "vitest";

import { runScan } from "./scan-repository";
import type { FileProvider } from "./file-provider";

function provider(files: Record<string, string>): FileProvider {
  return {
    async listFiles() {
      return Object.keys(files);
    },
    async readFile(path: string) {
      return files[path.replace(/^\/+/, "")] ?? null;
    },
  };
}

// Deliberately free of the words the scanner treats as placeholders ("example", "sample",
// "dummy", …) — otherwise these are correctly suppressed and the test proves nothing.
const LEAKY_PY =
  `import os\n\n` +
  `STRIPE_SECRET_KEY = "sk_live_4eC39HqLyjWDarjtT1zdp7dc"\n` + // gitleaks:allow
  `AWS_ACCESS_KEY_ID = "AKIA2E0ZQ9RTLM4XKD7B"\n`; // gitleaks:allow

const APP_PY = `from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}
`;

function secretFindings(issues: { fixId: string }[]): string[] {
  return issues.map((i) => i.fixId).filter((id) => id.includes("secret"));
}

describe("subdirectory apps are scanned, not skipped", () => {
  it("detects the language of an app in a subdirectory", async () => {
    const scan = await runScan(
      provider({
        "README.md": "# app",
        "backend/requirements.txt": "fastapi==0.111.0\n",
        "backend/app/main.py": APP_PY,
      }),
    );
    expect(scan.framework).toBe("Python");
  });

  it("finds hardcoded secrets in a subdirectory app", async () => {
    const scan = await runScan(
      provider({
        "README.md": "# app",
        "backend/requirements.txt": "fastapi==0.111.0\n",
        "backend/app/main.py": LEAKY_PY,
      }),
    );
    expect(secretFindings(scan.issues).length).toBeGreaterThan(0);
  });

  it("scores a subdirectory leak no better than the same leak at the root", async () => {
    // The original bug reported 76 for the subdirectory case and 38 for the root case —
    // the product actively told the less safe user they were safer.
    const root = await runScan(
      provider({
        "README.md": "# app",
        "requirements.txt": "fastapi==0.111.0\n",
        "main.py": LEAKY_PY,
      }),
    );
    const sub = await runScan(
      provider({
        "README.md": "# app",
        "backend/requirements.txt": "fastapi==0.111.0\n",
        "backend/main.py": LEAKY_PY,
      }),
    );
    expect(sub.score).toBeLessThanOrEqual(root.score);
    expect(secretFindings(sub.issues).length).toBeGreaterThan(0);
  });

  it("counts an in-app credential once when the repo-wide sweep overlaps the app scan", async () => {
    const root = await runScan(
      provider({
        "requirements.txt": "fastapi==0.111.0\n",
        "main.py": LEAKY_PY,
      }),
    );
    const sub = await runScan(
      provider({
        "backend/requirements.txt": "fastapi==0.111.0\n",
        "backend/main.py": LEAKY_PY,
      }),
    );
    const rootFinding = root.issues.find((issue) => issue.fixId === "security-hardcoded-secret");
    const subFinding = sub.issues.find((issue) => issue.fixId === "security-hardcoded-secret");
    expect(subFinding?.title).toBe(rootFinding?.title);
    expect(subFinding?.foundEvidence).toBe(rootFinding?.foundEvidence);
  });

  it("sweeps for secrets outside the app directory it scanned", async () => {
    // A workspace monorepo must not be able to hide a key in a sibling package.
    const scan = await runScan(
      provider({
        "package.json": '{"private":true,"workspaces":["apps/*","packages/*"]}',
        "apps/web/package.json": '{"name":"web","dependencies":{"next":"14.2.5"}}',
        "apps/web/app/page.tsx": "export default function P(){return null}",
        "packages/config/settings.ts": `export const STRIPE = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";`, // gitleaks:allow
      }),
    );
    expect(scan.framework).toBe("Next.js");
    expect(secretFindings(scan.issues).length).toBeGreaterThan(0);
  });

  it("tells the user which directory was scanned and what was skipped", async () => {
    const scan = await runScan(
      provider({
        "README.md": "# app",
        "backend/requirements.txt": "fastapi==0.111.0\n",
        "backend/main.py": APP_PY,
        "frontend/package.json": '{"name":"web","dependencies":{"react":"18.3.1"}}',
        "frontend/src/main.jsx": "console.log(1)",
      }),
    );
    const notice = scan.warnings.find((w) => w.includes("backend"));
    expect(notice).toBeDefined();
    expect(notice).toContain("frontend");
    expect(notice).toContain("One-click fixes are placed beside the detected app");
    expect(notice).not.toContain("unavailable");
  });
});

describe("repositories with no application", () => {
  it("does not claim a README-only repo is production ready", async () => {
    const scan = await runScan(provider({ "README.md": "# just docs" }));
    expect(scan.score).toBe(0);
    expect(scan.warnings.some((w) => w.startsWith("UNSUPPORTED_REPO:"))).toBe(true);
  });

  it("does not fire for a repo that does have source", async () => {
    const scan = await runScan(
      provider({
        "package.json": '{"name":"app","dependencies":{"express":"4.19.2"}}',
        "src/server.js": "const express = require('express');",
      }),
    );
    expect(scan.warnings.some((w) => w.startsWith("UNSUPPORTED_REPO:"))).toBe(false);
    expect(scan.score).toBeGreaterThan(0);
  });
});

describe("single-app repositories are unaffected", () => {
  it("scans a root-level app exactly as before", async () => {
    const scan = await runScan(
      provider({
        "package.json": '{"name":"app","dependencies":{"next":"14.2.5"}}',
        "app/page.tsx": "export default function P(){return null}",
      }),
    );
    expect(scan.framework).toBe("Next.js");
    // No rebase notice — nothing was skipped.
    expect(scan.warnings.some((w) => w.includes("scanned `"))).toBe(false);
  });
});

describe("fixes offered for a subdirectory app", () => {
  // Fixes used to be withheld here, because generated files went to hardcoded repo-root paths.
  // The executor now resolves the same app directory the scan did and writes beneath it
  // (`collectFixFiles` → `placeGeneratedFile`), so a subdirectory app gets the same fixes as
  // any other. Placement itself is covered in `fix-executor/place-generated-file.test.ts`.
  async function findingsFor(): Promise<Map<string, boolean>> {
    const scan = await runScan(
      provider({
        "README.md": "# app",
        "backend/requirements.txt": "fastapi==0.111.0\n",
        "backend/app/main.py": APP_PY,
      }),
    );
    return new Map(scan.findings.map((f) => [f.fixId, f.autoFixable]));
  }

  it("offers the same fixes it would for a root-level app", async () => {
    const f = await findingsFor();
    for (const id of ["dockerfile", "pytest", "ruff", "health-check"]) {
      if (f.has(id)) expect(f.get(id), `${id} should be auto-fixable`).toBe(true);
    }
  });

  it("offers repo-level fixes too", async () => {
    const f = await findingsFor();
    for (const id of ["github-actions", "ci-ai", "readme", "readme-ai", "env-example-ai"]) {
      if (f.has(id)) expect(f.get(id), `${id} should stay auto-fixable`).toBe(true);
    }
  });

  it("leaves a root-level app's fixes untouched", async () => {
    const scan = await runScan(
      provider({
        "package.json": '{"name":"app","dependencies":{"express":"4.19.2"}}',
        "src/server.js": "const express = require('express'); const app = express();",
      }),
    );
    const f = new Map(scan.findings.map((x) => [x.fixId, x.autoFixable]));
    for (const id of ["dockerfile", "health-check", "helmet"]) {
      if (f.has(id)) expect(f.get(id), `${id} should be auto-fixable at root`).toBe(true);
    }
  });
});
