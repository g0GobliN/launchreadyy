import { describe, expect, it } from "vitest";
import { liveScanPoints, type LiveScanPoint } from "./live-scan-points";

const row = (over: Partial<LiveScanPoint>): LiveScanPoint => ({
  domain: "a.com",
  status: "completed",
  security_score: 80,
  created_at: "2026-08-10T00:00:00Z",
  ...over,
});

describe("liveScanPoints", () => {
  it("returns oldest-first, since the scan list arrives newest-first", () => {
    const points = liveScanPoints(
      [
        row({ security_score: 90, created_at: "2026-08-12T00:00:00Z" }),
        row({ security_score: 70, created_at: "2026-08-11T00:00:00Z" }),
        row({ security_score: 50, created_at: "2026-08-10T00:00:00Z" }),
      ],
      "a.com",
    );
    expect(points.map((p) => p.value)).toEqual([50, 70, 90]);
  });

  it("keeps one domain's line to itself", () => {
    // Two domains on one repo would otherwise draw a zig-zag that never happened to either.
    const points = liveScanPoints(
      [row({ domain: "a.com", security_score: 90 }), row({ domain: "b.com", security_score: 20 })],
      "a.com",
    );
    expect(points.map((p) => p.value)).toEqual([90]);
  });

  it("drops rows with no score instead of plotting them as zero", () => {
    const points = liveScanPoints(
      [
        row({ status: "queued", security_score: null }),
        row({ status: "failed", security_score: null }),
        row({ status: "completed", security_score: 60 }),
      ],
      "a.com",
    );
    expect(points.map((p) => p.value)).toEqual([60]);
  });

  it("drops a completed row whose score never landed", () => {
    expect(liveScanPoints([row({ status: "completed", security_score: null })], "a.com")).toEqual(
      [],
    );
  });

  it("is empty when nothing matches", () => {
    expect(liveScanPoints([], "a.com")).toEqual([]);
    expect(liveScanPoints([row({ domain: "other.com" })], "a.com")).toEqual([]);
  });
});
