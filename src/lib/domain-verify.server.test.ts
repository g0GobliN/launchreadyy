import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  DOMAIN_VERIFY_PATH,
  buildDomainVerifyToken,
  domainVerifyUrls,
  assertDomainHttpOwnership,
} from "./domain-verify.server";

const envBackup = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
});

afterEach(() => {
  process.env.SESSION_SECRET = envBackup;
  vi.unstubAllGlobals();
});

describe("buildDomainVerifyToken", () => {
  it("is stable for the same login+domain", async () => {
    const a = await buildDomainVerifyToken("octo", "example.com");
    const b = await buildDomainVerifyToken("octo", "example.com");
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it("differs across users and domains", async () => {
    const a = await buildDomainVerifyToken("octo", "example.com");
    const b = await buildDomainVerifyToken("other", "example.com");
    const c = await buildDomainVerifyToken("octo", "other.com");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("domainVerifyUrls", () => {
  it("prefers https then http well-known path", () => {
    expect(domainVerifyUrls("example.com")).toEqual([
      `https://example.com${DOMAIN_VERIFY_PATH}`,
      `http://example.com${DOMAIN_VERIFY_PATH}`,
    ]);
  });
});

describe("assertDomainHttpOwnership", () => {
  it("accepts a matching HTTPS body", async () => {
    const token = await buildDomainVerifyToken("octo", "example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("https://")) {
          return new Response(`launchreadyy-verify\n${token}\n`, { status: 200 });
        }
        return new Response("no", { status: 404 });
      }),
    );
    await expect(assertDomainHttpOwnership("example.com", token)).resolves.toBeUndefined();
  });

  it("rejects when token is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unrelated", { status: 200 })),
    );
    await expect(assertDomainHttpOwnership("example.com", "abc")).rejects.toThrow(
      /Ownership not verified/,
    );
  });
});
