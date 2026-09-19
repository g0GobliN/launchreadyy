import type { MonitorCadence } from "./repo-monitor";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The blocker band boundary in computeReadinessScore: blockers are capped at 39. */
const BLOCKER_BAND_MAX = 39;

export interface RegressionFinding {
  title: string;
  severity: string;
  riskLevel: string;
}

export interface RegressionInput {
  /** No previous scan means no baseline — the first scan of a repo is not a regression. */
  hasBaseline: boolean;
  newFindings: RegressionFinding[];
  resolvedCount: number;
  score: number;
  previousScore: number | null;
  lastNotifiedAt: string | null;
  cadence: MonitorCadence;
  now?: number;
}

export type RegressionDecision =
  | { notify: false; reason: "no-baseline" | "nothing-serious" | "throttled" }
  | {
      notify: true;
      /** Plain-language summary. Never a raw score delta — see scoreNote. */
      headline: string;
      blockers: RegressionFinding[];
      highs: RegressionFinding[];
      /**
       * Score movement phrased as context, or null when the number would mislead.
       * The scorer confines blocker repos to [0,39] and clean ones to [40,100],
       * so a single new blocker shows up as a ~45-point cliff that has nothing to
       * do with how much worse the repo actually got. When the band is crossed we
       * say what happened instead of quoting the drop.
       */
      scoreNote: string | null;
    };

function isBlocker(f: RegressionFinding): boolean {
  return f.riskLevel === "blocker" || f.severity === "critical";
}

function isHigh(f: RegressionFinding): boolean {
  return !isBlocker(f) && (f.riskLevel === "high" || f.severity === "high");
}

/** True when the score jumped across the blocker band edge in either direction. */
export function crossedBlockerBand(previousScore: number | null, score: number): boolean {
  if (previousScore === null) return false;
  return previousScore <= BLOCKER_BAND_MAX !== score <= BLOCKER_BAND_MAX;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * Whether a completed monitor scan is worth emailing about, and what to say.
 *
 * Deliberately triggers on *new blocker/high findings*, not on score movement.
 * Score is a lossy, banded summary; the findings are the thing the user has to
 * act on, and they are what makes the email worth opening.
 */
export function decideRegressionNotice(input: RegressionInput): RegressionDecision {
  if (!input.hasBaseline) return { notify: false, reason: "no-baseline" };

  const blockers = input.newFindings.filter(isBlocker);
  const highs = input.newFindings.filter(isHigh);
  if (blockers.length === 0 && highs.length === 0) {
    return { notify: false, reason: "nothing-serious" };
  }

  // One email per repo per cadence period, however often we scan.
  if (input.lastNotifiedAt) {
    const now = input.now ?? Date.now();
    const elapsed = now - new Date(input.lastNotifiedAt).getTime();
    const window = input.cadence === "daily" ? DAY_MS : WEEK_MS;
    if (!Number.isNaN(elapsed) && elapsed < window) {
      return { notify: false, reason: "throttled" };
    }
  }

  const headline =
    blockers.length > 0
      ? blockers.length === 1
        ? `A launch blocker appeared: ${blockers[0]!.title}`
        : `${blockers.length} launch blockers appeared`
      : `${plural(highs.length, "new high-severity issue", "new high-severity issues")} in your repo`;

  const scoreNote = buildScoreNote(input);

  return { notify: true, headline, blockers, highs, scoreNote };
}

function buildScoreNote(input: RegressionInput): string | null {
  if (input.previousScore === null) return null;

  if (crossedBlockerBand(input.previousScore, input.score)) {
    // Quoting the delta here would report a ~45-point crash caused purely by the
    // band cap. Say what actually changed.
    return input.score <= BLOCKER_BAND_MAX
      ? "Your repo now has an unresolved launch blocker, so it is scored in the blocker band."
      : "Your last launch blocker is resolved, so your repo is out of the blocker band.";
  }

  const delta = input.score - input.previousScore;
  if (delta === 0) return `Readiness score unchanged at ${input.score}.`;
  return delta < 0
    ? `Readiness score ${input.previousScore} → ${input.score} (down ${Math.abs(delta)}).`
    : `Readiness score ${input.previousScore} → ${input.score} (up ${delta}).`;
}
