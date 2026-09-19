import { describe, expect, it } from "vitest";
import {
  crossedBlockerBand,
  decideRegressionNotice,
  type RegressionInput,
} from "./repo-regression";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const finding = (title: string, riskLevel: string, severity = "medium") => ({
  title,
  severity,
  riskLevel,
});

function input(over: Partial<RegressionInput> = {}): RegressionInput {
  return {
    hasBaseline: true,
    newFindings: [],
    resolvedCount: 0,
    score: 70,
    previousScore: 70,
    lastNotifiedAt: null,
    cadence: "weekly",
    now: NOW,
    ...over,
  };
}

describe("decideRegressionNotice", () => {
  it("never notifies on a repo's first scan", () => {
    const d = decideRegressionNotice(
      input({ hasBaseline: false, newFindings: [finding("Leaked .env", "blocker")] }),
    );
    expect(d).toEqual({ notify: false, reason: "no-baseline" });
  });

  it("ignores new low and medium findings", () => {
    // Emailing about every cosmetic nit is how a useful alert becomes noise
    // people filter — only act-now findings earn an interruption.
    const d = decideRegressionNotice(
      input({
        newFindings: [finding("Missing README badge", "low"), finding("Add prettier", "medium")],
      }),
    );
    expect(d).toEqual({ notify: false, reason: "nothing-serious" });
  });

  it("notifies on a new blocker, naming it", () => {
    const d = decideRegressionNotice(
      input({ newFindings: [finding("Unverified Stripe webhook", "blocker")] }),
    );
    expect(d.notify).toBe(true);
    if (!d.notify) return;
    expect(d.headline).toContain("Unverified Stripe webhook");
    expect(d.blockers).toHaveLength(1);
  });

  it("notifies on new high-severity findings", () => {
    const d = decideRegressionNotice(
      input({
        newFindings: [finding("No rate limiting", "high"), finding("CORS wide open", "high")],
      }),
    );
    expect(d.notify).toBe(true);
    if (!d.notify) return;
    expect(d.headline).toBe("2 new high-severity issues in your repo");
    expect(d.highs).toHaveLength(2);
  });

  it("treats critical severity as a blocker even when risk_level disagrees", () => {
    const d = decideRegressionNotice(
      input({ newFindings: [finding("Dependabot: lodash", "medium", "critical")] }),
    );
    expect(d.notify).toBe(true);
    if (!d.notify) return;
    expect(d.blockers).toHaveLength(1);
    expect(d.highs).toHaveLength(0);
  });

  describe("the 39/40 blocker band", () => {
    // computeReadinessScore confines blocker repos to [0,39] and clean repos to
    // [40,100]. One new blocker therefore looks like a ~45-point collapse that
    // says nothing about how much worse the repo got. Reporting that number
    // would make every blocker alert scream the same false magnitude.
    it("describes a band crossing in words, not as a score drop", () => {
      const d = decideRegressionNotice(
        input({
          newFindings: [finding("Leaked API key", "blocker")],
          previousScore: 84,
          score: 39,
        }),
      );
      expect(d.notify).toBe(true);
      if (!d.notify) return;
      expect(d.scoreNote).toBe(
        "Your repo now has an unresolved launch blocker, so it is scored in the blocker band.",
      );
      expect(d.scoreNote).not.toMatch(/\d+\s*→|down \d+|45/);
    });

    it("quotes the real delta when the band was not crossed", () => {
      const d = decideRegressionNotice(
        input({ newFindings: [finding("No rate limiting", "high")], previousScore: 80, score: 72 }),
      );
      expect(d.notify).toBe(true);
      if (!d.notify) return;
      expect(d.scoreNote).toBe("Readiness score 80 → 72 (down 8).");
    });

    it("detects the crossing in both directions", () => {
      expect(crossedBlockerBand(84, 39)).toBe(true);
      expect(crossedBlockerBand(20, 60)).toBe(true);
      expect(crossedBlockerBand(80, 72)).toBe(false);
      expect(crossedBlockerBand(10, 30)).toBe(false);
      expect(crossedBlockerBand(null, 30)).toBe(false);
    });
  });

  describe("throttling", () => {
    it("suppresses a second email inside the cadence window", () => {
      const d = decideRegressionNotice(
        input({
          newFindings: [finding("Leaked key", "blocker")],
          lastNotifiedAt: ago(2 * DAY),
          cadence: "weekly",
        }),
      );
      expect(d).toEqual({ notify: false, reason: "throttled" });
    });

    it("allows the next notice once the window has passed", () => {
      const d = decideRegressionNotice(
        input({
          newFindings: [finding("Leaked key", "blocker")],
          lastNotifiedAt: ago(8 * DAY),
          cadence: "weekly",
        }),
      );
      expect(d.notify).toBe(true);
    });

    it("uses a one-day window for daily cadence", () => {
      const base = {
        newFindings: [finding("Leaked key", "blocker")],
        cadence: "daily" as const,
      };
      expect(decideRegressionNotice(input({ ...base, lastNotifiedAt: ago(2 * DAY) })).notify).toBe(
        true,
      );
      expect(decideRegressionNotice(input({ ...base, lastNotifiedAt: ago(DAY / 2) })).notify).toBe(
        false,
      );
    });
  });
});
