/**
 * Where a generated file lands when the app is not at the repository root.
 *
 * This is the load-bearing half of the subdirectory fix: get it wrong in one direction and a
 * Dockerfile is committed to a root with no app in it; get it wrong in the other and an
 * in-place patch is written to `backend/backend/app/main.py`. Both produce a PR that cannot
 * work, so both directions are pinned here.
 */
import { describe, it, expect } from "vitest";

import { placeGeneratedFile } from "./body/collect-fix-files";

const repo = new Set([
  "README.md",
  "backend/requirements.txt",
  "backend/app/main.py",
  "frontend/package.json",
]);

describe("placeGeneratedFile", () => {
  describe("root-level app (appDir null)", () => {
    it("returns every path untouched", () => {
      for (const p of ["Dockerfile", "health.py", ".github/workflows/ci.yml", "src/index.ts"]) {
        expect(placeGeneratedFile(p, null, repo)).toBe(p);
      }
    });
  });

  describe("subdirectory app", () => {
    it("moves a constant config path under the app", () => {
      expect(placeGeneratedFile("Dockerfile", "backend", repo)).toBe("backend/Dockerfile");
      expect(placeGeneratedFile("ruff.toml", "backend", repo)).toBe("backend/ruff.toml");
      expect(placeGeneratedFile("health.py", "backend", repo)).toBe("backend/health.py");
    });

    it("moves nested constant paths under the app", () => {
      expect(placeGeneratedFile("middleware/rate_limit.py", "backend", repo)).toBe(
        "backend/middleware/rate_limit.py",
      );
      expect(placeGeneratedFile("internal/health/handler.go", "services/api", repo)).toBe(
        "services/api/internal/health/handler.go",
      );
    });

    it("leaves a path the handler discovered from the repo tree alone", () => {
      // `add(entryPoint, patched)` — entryPoint is already a real repo path.
      expect(placeGeneratedFile("backend/app/main.py", "backend", repo)).toBe(
        "backend/app/main.py",
      );
    });

    it("never double-prefixes an already-prefixed path", () => {
      expect(placeGeneratedFile("backend/Dockerfile", "backend", repo)).toBe("backend/Dockerfile");
    });

    it("leaves an existing repo file outside the app dir alone", () => {
      // An intentional in-place patch of a sibling, not a new config for our app.
      expect(placeGeneratedFile("frontend/package.json", "backend", repo)).toBe(
        "frontend/package.json",
      );
    });

    it("keeps CI workflows at the repository root", () => {
      // GitHub only reads workflows from the root.
      expect(placeGeneratedFile(".github/workflows/ci.yml", "backend", repo)).toBe(
        ".github/workflows/ci.yml",
      );
    });

    it("keeps repo-level docs and ignore files at the root", () => {
      expect(placeGeneratedFile("README.md", "backend", repo)).toBe("README.md");
      expect(placeGeneratedFile(".gitignore", "backend", repo)).toBe(".gitignore");
      expect(placeGeneratedFile(".env.example", "backend", repo)).toBe(".env.example");
      expect(placeGeneratedFile("LICENSE", "backend", repo)).toBe("LICENSE");
    });

    it("normalises a leading ./", () => {
      expect(placeGeneratedFile("./Dockerfile", "backend", repo)).toBe("backend/Dockerfile");
    });

    it("handles a nested app directory", () => {
      expect(placeGeneratedFile("Dockerfile", "apps/web", repo)).toBe("apps/web/Dockerfile");
      expect(placeGeneratedFile("apps/web/next.config.js", "apps/web", repo)).toBe(
        "apps/web/next.config.js",
      );
    });
  });
});
