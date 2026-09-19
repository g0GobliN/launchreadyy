const GLOBAL_IGNORES = `{
  ignores: ["node_modules/**", ".next/**", "dist/**", "build/**", "coverage/**", "types_db.ts"],
}`;

export const ESLINT_CONFIG_JS = `export default [${GLOBAL_IGNORES}, {
  files: ["**/*.{js,jsx,mjs,cjs}"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
  rules: {
    "no-console": ["warn", { allow: ["warn", "error"] }],
    eqeqeq: ["warn", "always"],
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  },
}];
`;

export const ESLINT_CONFIG = `import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [${GLOBAL_IGNORES}, {
  files: ["**/*.{ts,tsx}"],
  languageOptions: { parser },
  plugins: { "@typescript-eslint": tseslint },
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    eqeqeq: ["warn", "always"],
  },
}];
`;

export function eslintConfigForProject(usesTypeScript: boolean): string {
  return usesTypeScript ? ESLINT_CONFIG : ESLINT_CONFIG_JS;
}
