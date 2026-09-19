import { describe, expect, it } from "vitest";
import { isMonitorDue } from "./live-site-monitor";

describe("live-site monitor cadence", () => {
  it("marks due by cadence window", () => {
    const now = Date.parse("2026-07-16T12:00:00Z");
    expect(isMonitorDue("daily", null, now)).toBe(true);
    expect(isMonitorDue("daily", "2026-07-16T10:00:00Z", now)).toBe(false);
    expect(isMonitorDue("daily", "2026-07-15T11:00:00Z", now)).toBe(true);
    expect(isMonitorDue("weekly", "2026-07-09T12:00:00Z", now)).toBe(true);
    expect(isMonitorDue("weekly", "2026-07-14T12:00:00Z", now)).toBe(false);
  });
});
