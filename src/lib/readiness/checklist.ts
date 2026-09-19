import type { DetectedStack, LaunchChecklistItem } from "./types";
import type { ReadinessFinding } from "./types";

export interface ChecklistTemplateItem {
  id: string;
  label: string;
  /** fixId or auditor id that satisfies this item */
  failFixIds?: string[];
  /** pass if any of these fixIds are NOT in findings (inverse) */
  passWhenFixAbsent?: string[];
  profiles?: string[];
  stackRequires?: { service?: string; framework?: string; deploy?: string };
}

const TEMPLATES: ChecklistTemplateItem[] = [
  // Next.js profiles
  {
    id: "env-validation",
    label: "Env vars documented (.env.example)",
    failFixIds: ["env-example", "env-example-ai", "auditor-env-undocumented", "auditor-env-gap"],
    profiles: ["Next.js + Stripe", "Next.js App", "Express API", "React SPA"],
  },
  {
    id: "auth-protection",
    label: "Protected routes have auth guards",
    failFixIds: ["auditor-auth-routes"],
    profiles: ["Next.js + Stripe", "Next.js App"],
  },
  {
    id: "stripe-webhook",
    label: "Stripe webhooks verify signatures",
    failFixIds: ["auditor-stripe-webhook"],
    profiles: ["Next.js + Stripe"],
    stackRequires: { service: "Stripe" },
  },
  {
    id: "error-states",
    label: "Error boundary / error.tsx present",
    failFixIds: ["error-boundary"],
    profiles: ["Next.js + Stripe", "Next.js App"],
  },
  {
    id: "api-errors",
    label: "API input validation",
    failFixIds: ["auditor-api-validation"],
    profiles: ["Express API", "Next.js + Stripe"],
  },
  {
    id: "db-migrations",
    label: "Database migrations tracked",
    failFixIds: ["auditor-prisma-migrations"],
    stackRequires: { service: "Prisma" },
  },
  { id: "ci-pipeline", label: "CI runs on every push", failFixIds: ["github-actions", "ci-ai"] },
  {
    id: "unit-tests",
    label: "Unit test runner configured",
    failFixIds: ["vitest", "vitest-ai"],
    profiles: ["Next.js + Stripe", "Next.js App", "React SPA"],
  },
  {
    id: "e2e-tests",
    label: "End-to-end tests",
    failFixIds: ["playwright-ai"],
    profiles: ["Next.js + Stripe", "Next.js App"],
  },
  {
    id: "api-tests",
    label: "API integration tests",
    failFixIds: ["api-tests"],
    profiles: ["Express API"],
  },
  { id: "monitoring", label: "Production error monitoring", failFixIds: ["monitoring"] },
  {
    id: "rate-limit",
    label: "Rate limiting on API",
    failFixIds: ["rate-limit"],
    profiles: ["Express API"],
  },
  {
    id: "cors-helmet",
    label: "Security headers (Helmet)",
    failFixIds: ["helmet"],
    profiles: ["Express API"],
  },
  { id: "logging", label: "Request logging", failFixIds: ["logger"], profiles: ["Express API"] },
  { id: "readme", label: "README setup instructions", failFixIds: ["readme", "readme-ai"] },
  { id: "docker", label: "Container / deploy config", failFixIds: ["dockerfile"] },
  {
    id: "no-localhost",
    label: "No hardcoded localhost API URLs",
    failFixIds: ["auditor-localhost-api"],
    profiles: ["Next.js + Stripe", "React SPA"],
  },
  {
    id: "no-todos",
    label: "No widespread TODO placeholders",
    failFixIds: ["auditor-todo-markers"],
  },
  { id: "secrets", label: "No committed secrets", failFixIds: ["gitignore-env"] },
  {
    id: "production-build",
    label: "Lint script for CI",
    failFixIds: ["eslint"],
    profiles: ["React SPA", "Vite"],
  },
];

function appliesToStack(item: ChecklistTemplateItem, stack: DetectedStack): boolean {
  if (item.profiles && !item.profiles.includes(stack.profile)) return false;
  if (item.stackRequires?.service && !stack.services.includes(item.stackRequires.service))
    return false;
  if (item.stackRequires?.framework && !stack.frameworks.includes(item.stackRequires.framework))
    return false;
  if (item.stackRequires?.deploy && !stack.deployTargets.includes(item.stackRequires.deploy))
    return false;
  return true;
}

export function buildLaunchChecklist(
  stack: DetectedStack,
  findings: ReadinessFinding[],
): LaunchChecklistItem[] {
  const failFixIds = new Set(findings.map((f) => f.fixId));
  const findingByFixId = new Map(findings.map((f) => [f.fixId, f]));

  return TEMPLATES.filter((t) => appliesToStack(t, stack)).map((t) => {
    const failed = (t.failFixIds ?? []).filter((id) => failFixIds.has(id));
    const stackSpecific = Boolean(t.profiles || t.stackRequires);

    if (failed.length === 0) {
      return { id: t.id, label: t.label, status: "pass" as const, stackSpecific };
    }

    const worst = failed
      .map((id) => findingByFixId.get(id))
      .filter(Boolean)
      .sort((a, b) => (a!.priority ?? 99) - (b!.priority ?? 99))[0];

    const status = worst?.riskLevel === "blocker" ? ("fail" as const) : ("warn" as const);

    return {
      id: t.id,
      label: t.label,
      status,
      findingId: worst?.fixId,
      stackSpecific,
    };
  });
}

export function checklistSummary(items: LaunchChecklistItem[]) {
  const applicable = items.filter((i) => i.status !== "na");
  const passed = applicable.filter((i) => i.status === "pass").length;
  const failed = applicable.filter((i) => i.status === "fail").length;
  const warn = applicable.filter((i) => i.status === "warn").length;
  return { total: applicable.length, passed, failed, warn };
}
