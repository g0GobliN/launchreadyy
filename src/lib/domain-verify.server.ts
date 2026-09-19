/** HTTP well-known file challenge for live-site domain ownership. */

import { isBlockedHost, safeFetch } from "./ssrf-guard";

export const DOMAIN_VERIFY_PATH = "/.well-known/launchreadyy-verify.txt";

export async function buildDomainVerifyToken(login: string, domain: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("Server misconfigured (SESSION_SECRET)");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`launchreadyy-domain:${login}:${domain}`),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function domainVerifyUrls(domain: string): string[] {
  return [`https://${domain}${DOMAIN_VERIFY_PATH}`, `http://${domain}${DOMAIN_VERIFY_PATH}`];
}

/**
 * Prove control of the domain by publishing the verification token at
 * `/.well-known/launchreadyy-verify.txt` (HTTPS preferred, HTTP fallback).
 *
 * Uses {@link safeFetch}, so the host — and every redirect hop — is checked against the
 * SSRF blocklist. Without that, `169.254.169.254` and `127.0.0.1` both satisfy the caller's
 * dotted-label domain regex, and a follow-redirect would let an attacker-owned domain bounce
 * the request into a non-public address.
 */
export async function assertDomainHttpOwnership(domain: string, token: string): Promise<void> {
  if (isBlockedHost(domain)) {
    throw new Error("That host is not a public domain.");
  }

  for (const url of domainVerifyUrls(domain)) {
    try {
      const res = await safeFetch(url, {
        headers: { Accept: "text/plain,*/*" },
        timeoutMs: 8_000,
      });
      if (!res.ok) continue;
      const body = await res.text();
      if (body.includes(token)) return;
    } catch {
      // try next URL
    }
  }
  throw new Error(
    `Ownership not verified. Publish a file at https://${domain}${DOMAIN_VERIFY_PATH} containing your verification token, then try again.`,
  );
}
