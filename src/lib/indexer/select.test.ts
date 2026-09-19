import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the flag source and both Rust probes so the selector logic can be tested in isolation
// (no Supabase, no real binary/WASM needed).
const isFeatureEnabled = vi.fn<(key: string) => Promise<boolean>>();
const rustIndexerBinary = vi.fn<() => string | null>();
const rustNativeIndex = vi.fn();
const rustWasmAvailable = vi.fn<() => boolean>();
const rustWasmIndex = vi.fn();

vi.mock("../site-config.server", () => ({ isFeatureEnabled: (k: string) => isFeatureEnabled(k) }));
vi.mock("./rust-backend.server", () => ({
  rustIndexerBinary: () => rustIndexerBinary(),
  rustNativeIndex: (...args: unknown[]) => rustNativeIndex(...args),
}));
vi.mock("./wasm-backend.server", () => ({
  rustWasmAvailable: () => rustWasmAvailable(),
  rustWasmIndex: (...args: unknown[]) => rustWasmIndex(...args),
  rustWasmExtractImports: vi.fn(),
}));

import { getIndexer } from "./select.server";

afterEach(() => {
  vi.clearAllMocks();
});

describe("getIndexer", () => {
  it("returns the TS reference when the flag is off (even if native/WASM exist)", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    rustIndexerBinary.mockReturnValue("rust/target/release/lr-indexer");
    rustWasmAvailable.mockReturnValue(true);
    expect((await getIndexer()).id).toBe("ts-reference");
  });

  it("returns the TS reference when the flag is on but neither native nor WASM is available", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue(null);
    rustWasmAvailable.mockReturnValue(false);
    expect((await getIndexer()).id).toBe("ts-reference");
  });

  it("prefers the native binary over WASM when both are available", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue("rust/target/release/lr-indexer");
    rustWasmAvailable.mockReturnValue(true);
    expect((await getIndexer()).id).toBe("rust-native");
  });

  it("returns the WASM backend when the flag is on, no binary, and WASM inits", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue(null);
    rustWasmAvailable.mockReturnValue(true);
    expect((await getIndexer()).id).toBe("rust-wasm");
  });

  it("Rust-native backend falls back to TS per-call when a run returns null", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue("bin");
    rustNativeIndex.mockReturnValue(null);
    const indexer = await getIndexer();
    const out = indexer.index([{ path: "a.ts", content: "x" }]);
    expect(out.files).toHaveLength(1);
    expect(out.files[0].path).toBe("a.ts");
  });

  it("WASM backend falls back to TS per-call when a run returns null", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue(null);
    rustWasmAvailable.mockReturnValue(true);
    rustWasmIndex.mockReturnValue(null);
    const indexer = await getIndexer();
    expect(indexer.id).toBe("rust-wasm");
    const out = indexer.index([{ path: "a.ts", content: "x" }]);
    expect(out.files).toHaveLength(1);
  });

  it("never throws — a flag-check failure still yields the TS reference", async () => {
    isFeatureEnabled.mockRejectedValue(new Error("site_config unavailable"));
    expect((await getIndexer()).id).toBe("ts-reference");
  });
});
