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
  // TanStack Start file-based routing requires every route module to export `Route` — an
  // object, never a component — and keeps the route's UI as module-local functions referenced
  // via `component: Foo`. That combination trips this rule's `localComponents` branch on all 32
  // route files on every run, and there is no edit that clears it while satisfying the router:
  // exporting the components too would not make `Route` a component, so Fast Refresh's verdict
  // on the module is unchanged either way. The warning is therefore pure noise here, and noise
  // at this volume hides the real findings the rule does catch in `src/components/**`.
  //
  // Off for `src/routes/**` only — every other directory keeps the rule at full strength.
  {
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  eslintPluginPrettier,
);
