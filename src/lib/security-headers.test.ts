import { describe, expect, it } from "vitest";
import { securityHeaders, withSecurityHeaders } from "./security-headers";

function csp(): string {
  return securityHeaders()["Content-Security-Policy"]!;
}

/** Pull one directive's value out of a CSP string. */
function directive(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe("securityHeaders", () => {
  it("ships the headers that block framing, sniffing and downgrade", () => {
    const h = securityHeaders();
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Strict-Transport-Security"]).toContain("max-age=31536000");
  });

  it("locks down the dangerous CSP sinks", () => {
    const policy = csp();
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("allows only the font origins loaded by the browser", () => {
    const policy = csp();
    // Google Fonts splits stylesheet and font-file origins.
    expect(directive(policy, "style-src")).toContain("https://fonts.googleapis.com");
    expect(directive(policy, "font-src")).toContain("https://fonts.gstatic.com");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
    expect(directive(policy, "frame-src")).toBe("frame-src 'none'");
  });

  it("never allows script-src to fall back to a wildcard", () => {
    const scriptSrc = directive(csp(), "script-src")!;
    expect(scriptSrc).not.toContain("*");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'self'");
  });
});

describe("withSecurityHeaders", () => {
  it("preserves status, body and handler-set headers", async () => {
    const res = withSecurityHeaders(
      new Response("hi", { status: 201, headers: { "content-type": "text/plain" } }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hi");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("keeps redirects intact", () => {
    const res = withSecurityHeaders(
      new Response(null, { status: 302, headers: { location: "/dashboard" } }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("lets badge responses stay embeddable cross-origin", () => {
    const res = withSecurityHeaders(new Response("<svg/>"), { badge: true });
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBeNull();
  });
});
