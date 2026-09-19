import { describe, expect, it, vi } from "vitest";
import {
  BlockedOutboundUrlError,
  isAllowedOutboundUrl,
  isBlockedHost,
  safeFetch,
} from "./ssrf-guard";

describe("isBlockedHost", () => {
  it("blocks loopback and localhost spellings", () => {
    for (const h of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.1.2.3"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks cloud metadata addresses", () => {
    for (const h of ["169.254.169.254", "metadata.google.internal", "instance-data"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks RFC1918 and other non-public ranges", () => {
    for (const h of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks alternate-radix spellings of 127.0.0.1", () => {
    // inet_aton accepts these; a decimal-only check would let them through.
    for (const h of ["0x7f.0.0.1", "0177.0.0.1", "127.0.0.01"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks IPv6 loopback, unique-local and link-local", () => {
    for (const h of ["::1", "[::1]", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks internal-only suffixes", () => {
    for (const h of ["printer.local", "db.internal", "box.home.arpa", "x.onion"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("allows ordinary public domains and public IPs", () => {
    for (const h of [
      "example.com",
      "example.org",
      "sub.domain.co.uk",
      "8.8.8.8",
      "1.1.1.1",
      "172.32.0.1", // just outside 172.16/12
      "192.169.0.1", // just outside 192.168/16
      "100.128.0.1", // just outside CGNAT 100.64/10
    ]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });
});

describe("isAllowedOutboundUrl", () => {
  it("rejects non-http schemes", () => {
    for (const u of ["file:///etc/passwd", "gopher://x.com", "data:text/plain,hi"]) {
      expect(isAllowedOutboundUrl(u), u).toBe(false);
    }
  });

  it("rejects unparseable input", () => {
    expect(isAllowedOutboundUrl("not a url")).toBe(false);
  });

  it("accepts http and https public URLs", () => {
    expect(isAllowedOutboundUrl("https://example.com/.well-known/x.txt")).toBe(true);
    expect(isAllowedOutboundUrl("http://example.com/")).toBe(true);
  });

  it("ignores userinfo tricks that hide the real host", () => {
    // The real host here is example.com, not the metadata IP in the userinfo field.
    expect(isAllowedOutboundUrl("https://169.254.169.254@example.com/")).toBe(true);
    expect(isAllowedOutboundUrl("https://example.com@169.254.169.254/")).toBe(false);
  });
});

describe("safeFetch", () => {
  it("throws before making any request to a blocked host", async () => {
    const spy = vi.fn();
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      BlockedOutboundUrlError,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not follow a redirect into a blocked address", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
      );
    try {
      const res = await safeFetch("https://evil.example.com/.well-known/x.txt");
      // Chain dead-ends: caller sees the 3xx, which is not `ok`, so verification fails.
      expect(res.status).toBe(302);
      expect(res.ok).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("follows redirects between public hosts", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "https://www.example.com/x" } }),
      )
      .mockResolvedValueOnce(new Response("token-value", { status: 200 }));
    try {
      const res = await safeFetch("https://example.com/x");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("token-value");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stops after maxRedirects", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }),
      );
    try {
      const res = await safeFetch("https://example.com/start", { maxRedirects: 2 });
      expect(res.status).toBe(302);
      expect(fetchSpy).toHaveBeenCalledTimes(3); // initial + 2 hops
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("never passes redirect:follow to the underlying fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    try {
      await safeFetch("https://example.com/x");
      expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
