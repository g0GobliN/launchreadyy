import type { IssueInput } from "../scanner-rules";

export const READINESS_CATEGORIES = [
  "Security",
  "Environment setup",
  "Error handling",
  "Testing",
  "CI/CD",
  "Deployment readiness",
  "Documentation",
  "Database/migration safety",
  "API reliability",
  "Frontend UX basics",
  "Performance",
  "Maintainability",
] as const;

export type ReadinessCategory = (typeof READINESS_CATEGORIES)[number];

export type RiskLevel = "blocker" | "high" | "medium" | "low";
export type AffectedAudience = "users" | "customers" | "team" | "business";
export type FixDifficulty = "trivial" | "easy" | "medium" | "hard";
export type FindingSource = "rule" | "auditor" | "arch";

export interface ReadinessFinding extends IssueInput {
  riskLevel: RiskLevel;
  businessImpact: string;
  productionScenario: string;
  affectedAudience: AffectedAudience;
  fixDifficulty: FixDifficulty;
  priority: number;
  autoFixable: boolean;
  source: FindingSource;
  fixPackId?: string;
  readinessCategory: ReadinessCategory;
}

export interface CategoryScore {
  category: ReadinessCategory;
  score: number;
  issueCount: number;
  blockerCount: number;
}

export interface ReadinessScoreResult {
  overallScore: number;
  categoryScores: CategoryScore[];
}

export type LaunchChecklistStatus = "pass" | "fail" | "warn" | "na";

export interface LaunchChecklistItem {
  id: string;
  label: string;
  status: LaunchChecklistStatus;
  findingId?: string;
  stackSpecific: boolean;
}

export interface DetectedStack {
  frameworks: string[];
  services: string[];
  deployTargets: string[];
  profile: string;
}
