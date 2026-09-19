import { describe, expect, it, vi } from "vitest";
import {
  MAX_SWEEP_CANDIDATES,
  issuesFromSecretSweep,
  parseSweepPaths,
  secretSweepCommand,
} from "./secret-sweep";
import { SAMPLED_SCOPE_NOTE } from "../scanner/security/secrets";

/**
 * Deliberately not AWS's documented `AKIAIOSFODNN7EXAMPLE` — that string contains "EXAMPLE", which
 * the authoritative scanner rejects as a placeholder, so it would test nothing.
 */
const AWS_KEY = "AKIA3F7KQ2NBVC5XZLPD"; // gitleaks:allow

describe("secretSweepCommand", () => {
  const cmd = secretSweepCommand();

  it("skips node_modules, which install creates and would dwarf the tree", () => {
    expect(cmd).toContain("--exclude-dir=node_modules");
  });

  it("lists paths only, so a key's value never reaches the log", () => {
    expect(cmd).toMatch(/grep -rIlEi/);
  });

  it("survives finding nothing — grep exits 1 when there are no matches", () => {
    expect(cmd).toContain("|| true");
  });

  it("caps the candidate list", () => {
    expect(cmd).toContain(`head -${MAX_SWEEP_CANDIDATES}`);
  });

  /**
   * The pattern is interpolated into a single-quoted shell argument. A `'` inside it would end
   * that argument early and turn the rest of the pattern into stray shell words.
   */
  it("contains no single quote that would break shell quoting", () => {
    const pattern = /-e '([^']*)'/.exec(cmd);
    expect(pattern).not.toBeNull();
    expect(pattern![1]).not.toContain("'");
  });
});

describe("parseSweepPaths", () => {
  it("strips grep's leading ./ and dedupes", () => {
    expect(parseSweepPaths("./src/a.ts\n./src/b.ts\n./src/a.ts\n")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseSweepPaths("\n\n./x.ts\n  \n")).toEqual(["x.ts"]);
  });

  it("drops paths that escape the checkout", () => {
    expect(parseSweepPaths("./../../etc/passwd\n/etc/shadow\n./ok.ts")).toEqual(["ok.ts"]);
  });
});

describe("issuesFromSecretSweep", () => {
  const verifiedAt = "2026-07-31T00:00:00.000Z";

  it("reports a key found in a file the fast tier never sampled", async () => {
    const readFile = vi.fn(async (p: string) =>
      p === "src/deep/config.ts" ? `export const key = "${AWS_KEY}";` : null,
    );
    const issues = await issuesFromSecretSweep({
      stdout: "./src/deep/config.ts\n",
      readFile,
      verifiedAt,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]!.fixId).toBe("security-hardcoded-secret");
    expect(issues[0]!.severity).toBe("critical");
    expect(issues[0]!.verifiedAt).toBe(verifiedAt);
    expect(issues[0]!.detection).toContain("sandbox-verified");
  });

  it("claims whole-repo scope rather than repeating the sampling caveat", async () => {
    const issues = await issuesFromSecretSweep({
      stdout: "./a.ts",
      readFile: async () => `const k = "${AWS_KEY}";`,
      verifiedAt,
    });
    expect(issues[0]!.checkedFor).not.toContain(SAMPLED_SCOPE_NOTE);
    expect(issues[0]!.checkedFor!.join(" ")).toMatch(/every file in the repository/);
  });

  it("discloses when the candidate list was capped", async () => {
    const stdout = Array.from({ length: MAX_SWEEP_CANDIDATES }, (_, i) => `./file${i}.ts`).join(
      "\n",
    );
    const issues = await issuesFromSecretSweep({
      stdout,
      readFile: async () => `const k = "${AWS_KEY}";`,
      verifiedAt,
    });
    expect(issues[0]!.checkedFor!.join(" ")).toMatch(/capped at/);
  });

  it("returns nothing when the sweep found nothing", async () => {
    const readFile = vi.fn();
    expect(await issuesFromSecretSweep({ stdout: "", readFile, verifiedAt })).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("still reports when some candidate files cannot be read", async () => {
    const issues = await issuesFromSecretSweep({
      stdout: "./gone.ts\n./here.ts",
      readFile: async (p) => (p === "here.ts" ? `const k = "${AWS_KEY}";` : null),
      verifiedAt,
    });
    expect(issues).toHaveLength(1);
  });

  it("does not throw when a read rejects", async () => {
    const issues = await issuesFromSecretSweep({
      stdout: "./boom.ts\n./here.ts",
      readFile: async (p) => {
        if (p === "boom.ts") throw new Error("network");
        return `const k = "${AWS_KEY}";`;
      },
      verifiedAt,
    });
    expect(issues).toHaveLength(1);
  });

  /**
   * The sweep's looser patterns exist to over-match; the authoritative check is what decides. A
   * placeholder in a real source file must survive the sweep and still be rejected downstream.
   */
  it("defers to the authoritative check, which rejects placeholders", async () => {
    const issues = await issuesFromSecretSweep({
      stdout: "./src/config.ts",
      readFile: async () => `const API_KEY = "your-key-here-replace-me-1234567890";`,
      verifiedAt,
    });
    expect(issues).toEqual([]);
  });

  it("skips env templates, which are placeholders by definition", async () => {
    const issues = await issuesFromSecretSweep({
      stdout: "./.env.example",
      readFile: async () => `AWS_KEY="${AWS_KEY}"`,
      verifiedAt,
    });
    expect(issues).toEqual([]);
  });
});
