/** Home page scan coverage — what every run checks, in evidence order. */
export type HomeCheck = {
  detail: string;
  name: string;
  category: string;
};

export const HOME_CHECKS: HomeCheck[] = [
  {
    detail:
      "The repo is cloned into an isolated environment and actually booted — install, build, and lint run end to end, so a green score means the app starts, not that a file exists.",
    name: "Boots from a clean clone",
    category: "Sandbox verify",
  },
  {
    detail:
      "Pipelines, triggers, and job permissions are read from the workflow files. Missing CI, unpinned actions, and over-scoped tokens each surface as their own finding.",
    name: "CI runs and is scoped",
    category: "Pipeline",
  },
  {
    detail:
      "Every variable the code reads is matched against what the environment actually provides, so the gap between your example file and a real deploy shows up before it breaks one.",
    name: "Environment is complete",
    category: "Config",
  },
  {
    detail:
      "Source is parsed for hardcoded secrets, injection paths, and unsafe defaults. Each result points at a real file and line with a confidence level attached to it.",
    name: "Secrets and unsafe patterns",
    category: "Production Security",
  },
  {
    detail:
      "Test presence, health endpoints, and container setup are checked together — the three gaps that most often turn a working local repo into an unshippable one.",
    name: "Tests, health, and Docker",
    category: "Readiness",
  },
  {
    detail:
      "Anything the scan can close is written as a pull request against a branch. You read the diff and merge on your own schedule — nothing is ever pushed to main.",
    name: "Fixes arrive as a PR",
    category: "Remediation",
  },
];
