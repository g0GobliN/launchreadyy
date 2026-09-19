import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `pkg/` is wasm-pack's generated glue — gitignored, but eslint does not read .gitignore, so
  // running `npm run wasm:build` would otherwise flood `npm run lint` with errors from generated code.
  //
  // `.scratch/` holds real repositories cloned as fix-tool fixtures. Same reasoning, but it fails
  // harder: those are other people's projects, and one carrying its own prettier config for a
  // plugin we don't install crashes `npm run lint` outright instead of merely adding noise.
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "rust/crates/indexer/pkg",
      ".scratch",
      // Minimal smoke fixtures may use JSX in .js (Next/Vite) — not app source.
      "fixtures",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Keep lint scope stable; React Compiler rules need a separate migration.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
