import { needsReactPlugin } from "../shared/helpers";

export const VITEST_COVERAGE = `    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: ["node_modules", "dist", "e2e", "**/*.config.*", "**/*.d.ts"],
    },`;

export const VITEST_CONFIG_REACT = `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
${VITEST_COVERAGE}
  },
});
`;

export const VITEST_CONFIG_JSDOM = `import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
${VITEST_COVERAGE}
  },
});
`;

export const VITEST_CONFIG_JS_REACT = `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
`;

export const VITEST_CONFIG_JS_NODE = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
`;

export const VITEST_CONFIG_JS_JSDOM = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
`;

export const VITEST_CONFIG_NODE = `import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
${VITEST_COVERAGE}
  },
});
`;

export function vitestConfig(
  framework: string,
  deps: Record<string, string>,
  usesTypeScript = true,
): string {
  if (!usesTypeScript) {
    if (framework === "Express" || framework === "unknown") return VITEST_CONFIG_JS_NODE;
    if (needsReactPlugin(framework, deps)) return VITEST_CONFIG_JS_REACT;
    return VITEST_CONFIG_JS_JSDOM;
  }
  if (framework === "Express" || framework === "unknown") return VITEST_CONFIG_NODE;
  if (needsReactPlugin(framework, deps)) return VITEST_CONFIG_REACT;
  return VITEST_CONFIG_JSDOM;
}

export function vitestConfigPath(usesTypeScript: boolean): string {
  return usesTypeScript ? "vitest.config.ts" : "vitest.config.js";
}

export function vitestDevDeps(
  framework: string,
  deps: Record<string, string>,
  usesTypeScript: boolean,
  withCoverage: boolean,
): Record<string, string> {
  return {
    vitest: "^3.0.0",
    ...(withCoverage ? { "@vitest/coverage-v8": "^3.0.0" } : {}),
    ...(usesTypeScript ? { "vite-tsconfig-paths": "^5.0.0" } : {}),
    ...(needsReactPlugin(framework, deps)
      ? {
          "@vitejs/plugin-react": "^5.0.0",
          ...(deps.vite ? {} : { vite: "^6.0.0" }),
        }
      : {}),
  };
}
