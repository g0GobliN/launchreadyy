import { defineConfig, type Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

/**
 * Inline `*.wasm` imports as a base64 Uint8Array module.
 *
 * Vite has no ESM WebAssembly integration for SSR builds ("ESM integration proposal for Wasm
 * is not supported currently"), and the wasm-pack artifact has to travel *inside* the server
 * bundle: the Node runtime loads it synchronously via `initSync`, so there is no separate
 * asset fetch to fall back on when Vite handles an application route.
 *
 * `wasm-backend.server.ts` consumes the default export as a BufferSource.
 */
function inlineWasm(): Plugin {
  return {
    name: "launchreadyy:inline-wasm",
    enforce: "pre",
    async load(id) {
      const file = id.split("?", 1)[0]!;
      if (!file.endsWith(".wasm")) return null;
      const base64 = (await readFile(file)).toString("base64");
      return [
        `const b64 = ${JSON.stringify(base64)};`,
        `const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");`,
        `const bytes = new Uint8Array(bin.length);`,
        `for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);`,
        `export default bytes;`,
      ].join("\n");
    },
  };
}

/** Suppress noisy [vite] HMR lines in the browser devtools console. */
function silenceViteHmrConsole(): Plugin {
  return {
    name: "silence-vite-hmr-console",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [
          {
            tag: "script",
            injectTo: "head-prepend",
            children: `(function(){var m=["log","info","debug"];var skip=function(a){return typeof a[0]==="string"&&a[0].indexOf("[vite]")===0};m.forEach(function(k){var o=console[k];console[k]=function(){if(!skip(arguments))o.apply(console,arguments);};});})();`,
          },
        ];
      },
    },
  };
}

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
  },
  plugins: [
    inlineWasm(),
    silenceViteHmrConsole(),
    tsconfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      server: {
        // Resolved relative to the src directory, not the project root — "./src/server.ts"
        // silently fails to resolve and the plugin then falls back to its bundled default
        // entry, dropping this app's security headers, request limits, badge route and
        // background-service boot.
        entry: "./server.ts",
      },
    }),
    react(),
  ],
});
