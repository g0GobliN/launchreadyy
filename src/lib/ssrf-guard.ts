/**
 * Blocklist for outbound fetches whose host comes from user input.
 *
 * Scope note: this runtime runs on the edge, not inside a VPC, so there is no
 * cloud metadata endpoint or internal service for a request to reach — the realistic
 * abuse is using LaunchReadyy as an anonymising probe against hosts the caller picked,
 * plus the 1-bit oracle a verification result leaks. Hostname/IP-literal filtering is
 * proportionate to that. It deliberately does not resolve DNS: a name that resolves to
 * a private address (DNS rebinding) is not blocked here, and on this platform that buys
 * an attacker nothing extra.
 *
 * @see src/lib/ssrf-guard.test.ts
 */

/** Host suffixes that only ever name internal infrastructure. */
const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".onion",
];

/** Exact hostnames used by cloud metadata services. */
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog", "instance-data"]);

/**
 * Parse one IPv4 octet, accepting the alternate radixes `inet_aton` allows —
 * `0x7f`, `0177` and plain decimal all mean 127, so all three must be caught.
 */
function parseOctet(part: string): number | null {
  if (part === "") return null;
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = parseInt(part.slice(2), 16);
  else if (/^0[0-7]+$/.test(part)) value = parseInt(part.slice(1), 8);
  else if (/^\d+$/.test(part)) value = parseInt(part, 10);
  else return null;
  return value >= 0 && value <= 255 ? value : null;
}

/** Dotted-quad → 32-bit int, or null when the host is not an IPv4 literal. */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    const octet = parseOctet(part);
    if (octet === null) return null;
    acc = acc * 256 + octet;
  }
  return acc;
}

/** CIDR ranges that must never be fetched. */
const BLOCKED_V4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — cloud metadata lives here
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function inRange(ip: number, base: string, bits: number): boolean {
  const baseInt = parseIPv4(base)!;
  // `<<` is signed 32-bit in JS; the >>> 0 keeps the mask unsigned.
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1) >>> 0) >>> 0;
  return (ip & mask) >>> 0 === (baseInt & mask) >>> 0;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::1" || h === "::") return true;
  // IPv4-mapped (::ffff:127.0.0.1) — judge it by the embedded v4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) return isBlockedHost(mapped[1]!);
  const head = h.split(":")[0] ?? "";
  if (/^f[cd][0-9a-f]{2}$/.test(head)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]$/.test(head)) return true; // fe80::/10 link-local
  return false;
}

/** True when `host` must not be fetched. Accepts a hostname or IP literal. */
export function isBlockedHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => (s.startsWith(".") ? h.endsWith(s) : h === s))) return true;
  if (isBlockedIPv6(h)) return true;

  const ipv4 = parseIPv4(h);
  if (ipv4 !== null) {
    return BLOCKED_V4_RANGES.some(([base, bits]) => inRange(ipv4, base, bits));
  }
  return false;
}

/** True when the URL is a fetchable http(s) URL whose host is not blocked. */
export function isAllowedOutboundUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  // Anything other than http(s) — file:, gopher:, data: — is never legitimate here.
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return !isBlockedHost(url.hostname);
}

export class BlockedOutboundUrlError extends Error {
  constructor(url: string) {
    super(`Refusing to fetch a non-public address: ${url}`);
    this.name = "BlockedOutboundUrlError";
  }
}

export type SafeFetchOptions = RequestInit & {
  /** Redirect hops to follow, each re-validated against the blocklist. Default 3. */
  maxRedirects?: number;
  timeoutMs?: number;
};

/**
 * `fetch` for user-supplied URLs. Validates the target, then follows redirects manually
 * so every hop is re-checked — `redirect: "follow"` would let an attacker-controlled host
 * 302 straight past the initial check into a blocked address.
 *
 * Throws {@link BlockedOutboundUrlError} if the first URL is blocked; a redirect *into* a
 * blocked address stops the chain and returns the 3xx response instead of throwing, so
 * callers treat it as "did not verify" rather than as a server error.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = 3, timeoutMs = 8_000, ...init } = opts;
  if (!isAllowedOutboundUrl(rawUrl)) throw new BlockedOutboundUrlError(rawUrl);

  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location || hop >= maxRedirects) return res;

    const next = new URL(location, current).toString();
    if (!isAllowedOutboundUrl(next)) return res; // dead-ends the chain, no throw
    current = next;
  }
}
