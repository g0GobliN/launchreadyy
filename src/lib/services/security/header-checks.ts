import type { IssueInput } from "../../scanner-rules";

export interface HeaderCheckResult {
  name: string;
  present: boolean;
  value?: string;
}

const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
] as const;

export function checkSecurityHeaders(headers: Headers): IssueInput[] {
  const issues: IssueInput[] = [];
  const lower = new Map<string, string>();
  headers.forEach((v, k) => lower.set(k.toLowerCase(), v));

  for (const name of SECURITY_HEADERS) {
    const value = lower.get(name);
    if (!value) {
      issues.push({
        category: "Security",
        title: `Missing ${name} header`,
        severity:
          name === "strict-transport-security" || name === "content-security-policy"
            ? "medium"
            : name === "permissions-policy" || name === "referrer-policy"
              ? "low"
              : "medium",
        why: `The ${name} response header was not present on the live site. Browsers therefore skip the protection it provides.`,
        timeSaved: "20m",
        fixId: `live-header-${name}`,
        checkedFor: [name],
        foundEvidence: `GET response missing ${name}.`,
        confidence: "high",
        detection: ["rule-based"],
        recommendedFix: `Configure your edge/app to send a production-ready ${name} header.`,
      });
    }
  }
  return issues;
}

export function checkCookieFlags(headers: Headers): IssueInput[] {
  const setCookies = headers.getSetCookie?.() ?? [];
  // undici may expose getSetCookie; fall back to single header
  const raw = setCookies.length > 0 ? setCookies : [headers.get("set-cookie")].filter(Boolean);
  if (raw.length === 0) return [];

  const weak: string[] = [];
  for (const c of raw as string[]) {
    const lower = c.toLowerCase();
    const missing: string[] = [];
    if (!lower.includes("secure")) missing.push("Secure");
    if (!lower.includes("httponly")) missing.push("HttpOnly");
    if (!/samesite=(strict|lax)/i.test(c)) missing.push("SameSite");
    if (missing.length > 0) weak.push(`${c.split("=")[0]}=… (missing ${missing.join(", ")})`);
  }
  if (weak.length === 0) return [];

  return [
    {
      category: "Security",
      title: `Weak Set-Cookie flags (${weak.length})`,
      severity: "medium",
      why: "Cookies without Secure, HttpOnly, and SameSite are easier to intercept or send cross-site.",
      timeSaved: "30m",
      fixId: "live-cookie-flags",
      checkedFor: ["Secure", "HttpOnly", "SameSite=Strict|Lax"],
      foundEvidence: `Found: ${weak.slice(0, 3).join("; ")}.`,
      confidence: "high",
      detection: ["rule-based"],
      recommendedFix: "Set Secure, HttpOnly, and SameSite on every session/auth cookie.",
    },
  ];
}
