import { describe, expect, it } from "vitest";
import { ARCH_SCAN_UNSUPPORTED_MESSAGE, isArchScanSupported } from "./project-context";

describe("arch-scanner.server", () => {
  it("supports every framework — language handling lives in arch-lang-profiles", () => {
    expect(isArchScanSupported("Next.js")).toBe(true);
    expect(isArchScanSupported("Vite")).toBe(true);
    expect(isArchScanSupported("Express")).toBe(true);
    expect(isArchScanSupported(null)).toBe(true);
    expect(isArchScanSupported("Python")).toBe(true);
    expect(isArchScanSupported("Go")).toBe(true);
    expect(isArchScanSupported("Ruby")).toBe(true);
    expect(isArchScanSupported("Java")).toBe(true);
    expect(isArchScanSupported("Rust")).toBe(true);
    expect(isArchScanSupported("C#")).toBe(true);
    expect(isArchScanSupported("Elixir")).toBe(true);
  });

  it("exposes a user-facing message for repos with no recognizable source", () => {
    expect(ARCH_SCAN_UNSUPPORTED_MESSAGE).toMatch(/recognizable source files/i);
  });
});
