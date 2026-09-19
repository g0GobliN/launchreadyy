export const SMOKE_TEST = `import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs without error", () => {
    expect(true).toBe(true);
  });
});
`;
