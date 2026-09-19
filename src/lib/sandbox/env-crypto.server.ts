/**
 * AES-256-GCM encryption for project_env_vars (Capability 3).
 * Separate master secret from SESSION_SECRET so a leak of one never exposes the other.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/** AES-GCM authentication tag length. Fixed, and checked on the way in. */
const GCM_TAG_BYTES = 16;

const KEY_CONTEXT = "env-var-encryption-v1"; // gitleaks:allow
export const ENV_VAR_KEY_VERSION = 1;

function masterSecret(): string {
  const secret = process.env.ENV_VAR_ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENV_VAR_ENCRYPTION_SECRET is required to encrypt project env vars");
  return secret;
}

function encryptionKey(): Buffer {
  return Buffer.from(createHmac("sha256", masterSecret()).update(KEY_CONTEXT).digest());
}

/** Encrypt a plaintext env value → `iv.authTag.ciphertext` (base64url, dot-joined). */
export function encryptEnvValue(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/** Decrypt a stored env value. Returns null on tamper / wrong key. */
export function decryptEnvValue(stored: string): string | null {
  try {
    const parts = stored.split(".");
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, ctB64] = parts;
    const key = encryptionKey();
    const iv = Buffer.from(ivB64!, "base64url");
    const authTag = Buffer.from(tagB64!, "base64url");
    const ciphertext = Buffer.from(ctB64!, "base64url");
    // Pin the tag length and reject anything shorter. Without this, Node accepts a truncated
    // authentication tag, and forging 4 bytes is vastly cheaper than forging 16 — the value
    // arrives from outside, so its length is not ours to trust.
    if (authTag.length !== GCM_TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
