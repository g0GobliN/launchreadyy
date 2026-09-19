/**
 * Scrub decrypted / synthesized env values from sandbox stdout/stderr
 * before persistence (Capability 3 / 8).
 */

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  const unique = [...new Set(secrets.filter((s) => s && s.length >= 4))];
  // Longest first so partial overlaps don't leave fragments.
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

/**
 * Cap log size so a noisy build can't blow up DB rows. Keeps the tail, not the head —
 * for a build log the most recent output (later steps, the final pass/fail summary,
 * an error at the end) matters far more than an install step's early chatter.
 */
export function truncateLog(text: string, maxChars = 32_000): string {
  if (text.length <= maxChars) return text;
  return `…[truncated ${text.length - maxChars} earlier chars]\n${text.slice(-maxChars)}`;
}
