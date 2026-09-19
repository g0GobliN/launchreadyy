import type { ReadinessCategory } from "./types";

/** Maps scanner/auditor category labels → readiness category. */
export const CATEGORY_MAP: Record<string, ReadinessCategory> = {
  Security: "Security",
  "Environment setup": "Environment setup",
  "Error handling": "Error handling",
  Testing: "Testing",
  "CI/CD": "CI/CD",
  Deployment: "Deployment readiness",
  "Deployment readiness": "Deployment readiness",
  Documentation: "Documentation",
  "Database/migration safety": "Database/migration safety",
  "API reliability": "API reliability",
  "Frontend UX basics": "Frontend UX basics",
  Performance: "Performance",
  Maintainability: "Maintainability",
  Monitoring: "Error handling",
  Reliability: "Error handling",
  "Code Quality": "Maintainability",
  Observability: "Maintainability",
};

export function toReadinessCategory(category: string): ReadinessCategory {
  return CATEGORY_MAP[category] ?? "Maintainability";
}

/** Weight for overall score (must sum to 100). Launch-critical categories weigh more. */
export const CATEGORY_WEIGHTS: Record<ReadinessCategory, number> = {
  Security: 14,
  "Environment setup": 8,
  "Error handling": 10,
  Testing: 10,
  "CI/CD": 10,
  "Deployment readiness": 8,
  Documentation: 5,
  "Database/migration safety": 8,
  "API reliability": 10,
  "Frontend UX basics": 7,
  Performance: 5,
  Maintainability: 5,
};

export const SEVERITY_PENALTY: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

export const RISK_FROM_SEVERITY: Record<string, "blocker" | "high" | "medium" | "low"> = {
  critical: "blocker",
  high: "high",
  medium: "medium",
  low: "low",
};
