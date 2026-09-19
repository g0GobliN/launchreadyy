import { describe, expect, it } from "vitest";
import {
  matchErrorPattern,
  scopeForSignature,
  foreignFailingPaths,
  isForeignTestFailure,
  type GeneratedFileRecord,
} from "./fix-recovery.server";

/**
 * Seeded from four CI failures observed on a real PR against g0GobliN/goblin_town (2026-08-03).
 * Every one shipped to users, and none was visible to the 2148-test unit suite or the 2h Docker
 * harness — the harness translates GitHub Actions into shell commands, so it never validates a
 * workflow the way GitHub does. The logs below are the real ones, trimmed.
 */
const WORKFLOW = ".github/workflows/ci.yml";

function ours(
  content = "name: CI\non:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
): GeneratedFileRecord[] {
  return [{ path: WORKFLOW, hash: "h", content }];
}

describe("CI failure signatures", () => {
  it("recognises a workflow GitHub could not parse", () => {
    const log = `Invalid workflow file: .github/workflows/ci.yml#L98\nmapping values are not allowed here`;
    const m = matchErrorPattern(log, ours());
    expect(m?.errorSignature).toBe("workflow-invalid-yaml");
    expect(m?.patch?.path).toBe(WORKFLOW);
    expect(scopeForSignature(m!.errorSignature)).toBe("ours");
  });

  it("recognises our own file failing the repo's prettier gate", () => {
    const log = `> prettier --check . && astro check\nChecking formatting...\n[warn] .github/workflows/ci.yml\n[warn] Code style issues found in the above file.`;
    const m = matchErrorPattern(log, ours());
    expect(m?.errorSignature).toBe("prettier-check-our-file");
    expect(scopeForSignature(m!.errorSignature)).toBe("ours");
  });

  it("bumps the pinned Node major to the one the log demands", () => {
    const log = `Node.js v20.20.2 is not supported by Astro!\nPlease upgrade Node.js to a supported version: ">=22.12.0"`;
    const wf = `jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "20"\n`;
    const m = matchErrorPattern(log, ours(wf));
    expect(m?.errorSignature).toBe("node-version-unsupported");
    expect(m?.patch?.content).toContain('node-version: "22"');
    expect(m?.patch?.content).not.toContain('node-version: "20"');
  });

  it("takes the highest demanded major from an OR'd range", () => {
    const log = `Error: requires Node >=20.19.0 || >=22.12.0 — current v18.0.0 is not supported by vite`;
    const wf = `          node-version: "18"\n`;
    const m = matchErrorPattern(log, ours(wf));
    expect(m?.patch?.content).toContain('node-version: "22"');
  });

  it("recognises a step for a script the repo does not define", () => {
    const log = `npm ERR! Missing script: "build"\nnpm ERR! To see a list of scripts, run: npm run`;
    const m = matchErrorPattern(log, ours());
    expect(m?.errorSignature).toBe("missing-npm-script");
    expect(scopeForSignature(m!.errorSignature)).toBe("ours");
  });
});

describe("attribution — never repair someone else's code", () => {
  it("reports a failing suite in files we never wrote, and offers no patch", () => {
    const log = `FAIL src/auth.test.ts\n  ✕ rejects an expired token\nAssertionError: expected 401 received 200\n    at src/auth.test.ts:42:5\nFAIL src/cart.test.ts\n  ✕ totals with discount\n3 tests failed`;
    const m = matchErrorPattern(log, ours());
    expect(m?.errorSignature).toBe("foreign-test-failure");
    expect(scopeForSignature(m!.errorSignature)).toBe("theirs");
    expect(m?.patch).toBeUndefined();
    expect(m?.rootCause).toContain("src/auth.test.ts");
    expect(m?.rootCause).toContain("didn't touch");
  });

  it("stays 'ours' when the failing suite names one of our files", () => {
    const log = `FAIL .github/workflows/ci.yml\n2 tests failed\nAssertionError: expected`;
    const m = matchErrorPattern(log, ours());
    expect(m?.errorSignature).not.toBe("foreign-test-failure");
  });

  it("claims nothing when no file can be named — evidence or silence", () => {
    expect(isForeignTestFailure("1 tests failed\nAssertionError: boom", [WORKFLOW])).toBeNull();
  });

  it("ignores dependency and build-output frames when attributing", () => {
    const log = `FAIL node_modules/foo/index.js\n  at dist/bundle.js:1:1\n  at src/real.ts:9:2\n1 tests failed`;
    expect(foreignFailingPaths(log, [WORKFLOW])).toEqual(["src/real.ts"]);
  });
});

describe("unknown failures", () => {
  it("returns null rather than forcing a match", () => {
    expect(matchErrorPattern("something nobody has ever seen before", ours())).toBeNull();
  });

  it("reports unknown scope for an unrecognised signature", () => {
    expect(scopeForSignature("not-a-real-signature")).toBe("unknown");
  });
});
