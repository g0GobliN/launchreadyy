import { describe, expect, it } from "vitest";
import { repoMonitorCadence } from "./repo-monitor";

describe("repoMonitorCadence", () => {
  it("monitors weekly", () => {
    expect(repoMonitorCadence()).toBe("weekly");
  });
});
