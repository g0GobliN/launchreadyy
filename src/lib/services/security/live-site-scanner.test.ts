import { describe, expect, it, vi } from "vitest";
import { checkSecurityHeaders, checkCookieFlags } from "./header-checks";
import { checkExposures } from "./exposure-checks";
import { checkTlsAndHttps } from "./tls-check";
import { runLiveSiteScan } from "./live-site-scanner";

function headersFrom(map: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(map)) h.set(k, v);
  return h;
}

describe("header-checks", () => {
  it("flags missing security headers", () => {
    const issues = checkSecurityHeaders(headersFrom({ "content-type": "text/html" }));
    expect(issues.some((i) => i.title.includes("strict-transport-security"))).toBe(true);
    expect(issues.some((i) => i.title.includes("content-security-policy"))).toBe(true);
  });

  it("flags weak cookies", () => {
    const h = headersFrom({});
    // emulate set-cookie via get
    vi.spyOn(h, "get").mockImplementation((name) =>
      name.toLowerCase() === "set-cookie" ? "session=abc" : null,
    );
    (h as Headers & { getSetCookie?: () => string[] }).getSetCookie = () => ["session=abc"];
    const issues = checkCookieFlags(h);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.fixId).toBe("live-cookie-flags");
  });
});

describe("exposure-checks", () => {
  it("flags exposed .env on 200", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        status: path === "/.env" ? 200 : 404,
        ok: path === "/.env",
        headers: new Headers(),
      } as Response;
    }) as unknown as typeof fetch;

    const issues = await checkExposures("https://example.com", fetchImpl);
    expect(issues.some((i) => i.title.includes("/.env"))).toBe(true);
  });
});

describe("tls-check", () => {
  it("flags HTTPS failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fail");
    }) as unknown as typeof fetch;
    const { httpsOk, issues } = await checkTlsAndHttps("example.com", fetchImpl);
    expect(httpsOk).toBe(false);
    expect(issues.some((i) => i.fixId === "live-https")).toBe(true);
  });
});

describe("runLiveSiteScan", () => {
  it("aggregates findings and scores", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://") && (init?.method === "HEAD" || init?.method === "GET")) {
        if (u.includes("/.env") || u.includes("/.git")) {
          return { status: 404, ok: false, headers: new Headers() } as Response;
        }
        return {
          status: 200,
          ok: true,
          headers: headersFrom({
            "strict-transport-security": "max-age=31536000",
            "content-security-policy": "default-src 'self'",
            "x-frame-options": "DENY",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "permissions-policy": "geolocation=()",
          }),
        } as Response;
      }
      if (u.startsWith("http://")) {
        return {
          status: 301,
          ok: false,
          headers: headersFrom({ location: "https://example.com/" }),
        } as Response;
      }
      return { status: 404, ok: false, headers: new Headers() } as Response;
    }) as unknown as typeof fetch;

    const result = await runLiveSiteScan("example.com", fetchImpl);
    expect(result.domain).toBe("example.com");
    expect(result.securityScore).toBeGreaterThanOrEqual(0);
  });
});
