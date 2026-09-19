const ENV_README_PAIRS: [string, string][] = [
  ["env-example-ai", "readme-ai"],
  ["env-example", "readme"],
];

/** README setup is bundled into .env.example when both issues are present. */
export function isReadmeBundledWithEnvExample(scanFixIds: Iterable<string>): boolean {
  const ids = new Set(scanFixIds);
  return ENV_README_PAIRS.some(([env, readme]) => ids.has(env) && ids.has(readme));
}

function bundledReadmeId(scanFixIds: Iterable<string>): string | null {
  const ids = new Set(scanFixIds);
  for (const [env, readme] of ENV_README_PAIRS) {
    if (ids.has(env) && ids.has(readme)) return readme;
  }
  return null;
}

/** Auto-include readme when env-example is selected and readme is also missing. */
export function expandBundledFixIds(fixIds: string[], scanFixIds: Iterable<string>): string[] {
  const expanded = new Set(fixIds);
  const readmeId = bundledReadmeId(scanFixIds);
  if (readmeId) {
    const envId = readmeId === "readme-ai" ? "env-example-ai" : "env-example";
    if (expanded.has(envId)) expanded.add(readmeId);
  }
  return [...expanded];
}

/** Hide standalone readme from the fix picker when bundled with env-example. */
export function isBundledReadmeFix(id: string, scanFixIds: Iterable<string>): boolean {
  const readmeId = bundledReadmeId(scanFixIds);
  return readmeId !== null && id === readmeId;
}
