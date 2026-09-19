import { describe, expect, it } from "vitest";
import { defaultFeatureFlags, isFeatureFlagKey, parseFeatureFlagValue } from "./feature-flags";

describe("feature-flags", () => {
  /**
   * Each of these is off because enabling it today carries a concrete, named cost — not because
   * it is merely unproven — so the reason is pinned here rather than left to be rediscovered.
   * Flipping one on means answering its reason, so the reason lives with the assertion:
   *
   * - `flag_rust_indexer`: its only wired path is the JSON bridge, benchmarked slower than the TS
   *   reference (315ms vs 192ms, rust/README.md).
   * - `flag_multi_agent_ai`: six AI roles per fix, not yet validated against live AI + GitHub.
   */
  it("keeps only the flags that would currently hurt turned off", () => {
    const flags = defaultFeatureFlags();
    const off = Object.entries(flags)
      .filter(([, enabled]) => !enabled)
      .map(([key]) => key)
      .sort();
    expect(off).toEqual(["flag_multi_agent_ai", "flag_rust_indexer"]);
  });

  /**
   * Semgrep and CodeQL were removed on licensing grounds, but site_config rows for their flags
   * still exist on every deployment that ran them. An unknown key must stay unknown — that is
   * what makes those rows inert instead of resurrecting a tool we may not ship.
   */
  it("rejects retired flag keys so leftover site_config rows are ignored", () => {
    expect(isFeatureFlagKey("flag_semgrep")).toBe(false);
    expect(isFeatureFlagKey("flag_codeql")).toBe(false);
  });

  it("defaults the shipped capabilities to enabled", () => {
    const flags = defaultFeatureFlags();
    expect(flags.flag_ai_fixes).toBe(true);
    expect(flags.flag_code_auditor).toBe(true);
    expect(flags.flag_sandbox_verify).toBe(true);
    expect(flags.flag_repo_monitoring).toBe(true);
  });

  it("parses stored values with fallback to default", () => {
    expect(parseFeatureFlagValue("flag_ai_fixes", "false")).toBe(false);
    expect(parseFeatureFlagValue("flag_ai_fixes", "true")).toBe(true);
    expect(parseFeatureFlagValue("flag_ai_fixes", null)).toBe(true);
    expect(parseFeatureFlagValue("flag_ai_fixes", "garbage")).toBe(true);
  });

  it("recognizes flag keys", () => {
    expect(isFeatureFlagKey("flag_playwright_ai")).toBe(true);
    expect(isFeatureFlagKey("flag_unknown")).toBe(false);
  });
});
