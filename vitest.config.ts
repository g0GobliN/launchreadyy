import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Cold `typescript` / wasm / lr-indexer under full-suite parallelism routinely exceeds the
    // default 5s; newly ungated Rust/WASM suites made that tip into flakes.
    testTimeout: 15_000,
  },
});
