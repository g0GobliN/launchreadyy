import { afterEach, describe, expect, it, vi } from "vitest";

const isFeatureEnabled = vi.fn<(key: string) => Promise<boolean>>();
const rustIndexerBinary = vi.fn<() => string | null>();
const rustWasmAvailable = vi.fn<() => boolean>();

vi.mock("../site-config.server", () => ({ isFeatureEnabled: (k: string) => isFeatureEnabled(k) }));
vi.mock("../indexer/rust-backend.server", () => ({
  rustIndexerBinary: () => rustIndexerBinary(),
}));
vi.mock("../indexer/wasm-backend.server", () => ({
  rustWasmAvailable: () => rustWasmAvailable(),
  rustWasmExtractImports: Object.assign(vi.fn(), { __id: "wasm-extract" }),
}));
vi.mock("./rust-imports.server", () => ({
  rustExtractImports: Object.assign(vi.fn(), { __id: "native-extract" }),
}));

import { rustWasmExtractImports } from "../indexer/wasm-backend.server";
import { rustExtractImports } from "./rust-imports.server";
import { getImportsExtractor } from "./select.server";

afterEach(() => {
  vi.clearAllMocks();
});

describe("getImportsExtractor", () => {
  it("returns undefined when the flag is off", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    rustIndexerBinary.mockReturnValue("bin");
    rustWasmAvailable.mockReturnValue(true);
    expect(await getImportsExtractor()).toBeUndefined();
  });

  it("returns undefined when the flag is on but neither backend is available", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue(null);
    rustWasmAvailable.mockReturnValue(false);
    expect(await getImportsExtractor()).toBeUndefined();
  });

  it("prefers the native extractor over WASM", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue("bin");
    rustWasmAvailable.mockReturnValue(true);
    expect(await getImportsExtractor()).toBe(rustExtractImports);
  });

  it("returns the WASM extractor when no binary is present", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    rustIndexerBinary.mockReturnValue(null);
    rustWasmAvailable.mockReturnValue(true);
    expect(await getImportsExtractor()).toBe(rustWasmExtractImports);
  });

  it("never throws — a flag-check failure yields undefined", async () => {
    isFeatureEnabled.mockRejectedValue(new Error("site_config unavailable"));
    expect(await getImportsExtractor()).toBeUndefined();
  });
});
