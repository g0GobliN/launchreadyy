import { describe, expect, it } from "vitest";
import {
  HELMET_LIVE_FIX_IDS,
  helmetAddressableFixIds,
  isLiveFixAddressable,
  liveFindingToRepoFixId,
} from "./live-fix-mapping";

describe("live fix mapping", () => {
  it("returns all target ids when every one is present", () => {
    expect(helmetAddressableFixIds(HELMET_LIVE_FIX_IDS)).toEqual([...HELMET_LIVE_FIX_IDS]);
  });

  it("returns only the ids that are actually present", () => {
    const findings = [
      "live-header-strict-transport-security",
      "live-header-content-security-policy",
      "live-http-redirect",
    ];
    expect(helmetAddressableFixIds(findings)).toEqual([
      "live-header-strict-transport-security",
      "live-header-content-security-policy",
    ]);
  });

  it("ignores fixIds outside the helmet mapping", () => {
    const findings = ["live-http-redirect", "live-cookie-flags", "live-https"];
    expect(helmetAddressableFixIds(findings)).toEqual([]);
  });

  it("returns an empty array for no findings", () => {
    expect(helmetAddressableFixIds([])).toEqual([]);
  });
});

describe("isLiveFixAddressable", () => {
  it("matches live-cookie-flags to security-cookie-flags", () => {
    expect(isLiveFixAddressable(["live-cookie-flags"], "security-cookie-flags")).toBe(true);
    expect(isLiveFixAddressable(["live-http-redirect"], "security-cookie-flags")).toBe(false);
  });

  it("matches live-http-redirect to https-redirect", () => {
    expect(isLiveFixAddressable(["live-http-redirect"], "https-redirect")).toBe(true);
    expect(isLiveFixAddressable(["live-cookie-flags"], "https-redirect")).toBe(false);
  });

  it("returns false when the finding is absent", () => {
    expect(isLiveFixAddressable([], "https-redirect")).toBe(false);
    expect(isLiveFixAddressable(["live-header-x-frame-options"], "https-redirect")).toBe(false);
  });

  it("matches helmet header findings to helmet", () => {
    expect(isLiveFixAddressable(["live-header-x-frame-options"], "helmet")).toBe(true);
    expect(isLiveFixAddressable(["live-http-redirect"], "helmet")).toBe(false);
  });
});

describe("liveFindingToRepoFixId", () => {
  it("maps header findings to helmet and 1:1 live ids to their repo fixes", () => {
    expect(liveFindingToRepoFixId("live-header-content-security-policy")).toBe("helmet");
    expect(liveFindingToRepoFixId("live-http-redirect")).toBe("https-redirect");
    expect(liveFindingToRepoFixId("live-cookie-flags")).toBe("security-cookie-flags");
    expect(liveFindingToRepoFixId("unknown")).toBeNull();
  });
});
