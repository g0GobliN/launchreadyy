import { defineConfig } from "vitest/config";

// Separate config for the two real-execution suites under scripts/ — real Docker/network
// execution, deliberately not part of the default `npm test` (see vitest.config.ts's src-only
// include). Run via `npm run verify:tools`.
//
// The include list is explicit, not `scripts/*.ts`: most files in scripts/ are tsx entrypoints,
// not suites, and several (real-tool-matrix.ts, bench-imports.ts) self-execute at import — a glob
// runs them for real and then fails the run with "No test suite found in file".
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/verify-fix-tools.ts", "scripts/verify-real-project.ts"],
    testTimeout: 10 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
