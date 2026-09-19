import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Prefixes that indicate a user-facing, safe error message.
const PUBLIC_PREFIXES = [
  "LIMIT:",
  "Not authenticated",
  "GitHub token",
  "Insufficient",
  "Too many requests",
  "Repo owner",
  "Repository not found",
  "No generated output",
  "Unauthorized",
  "reconnect",
  "upgrade",
  "unsupported",
  "Architecture analysis",
  "This fix",
  "This job",
  "Invalid",
  // Names no internals, and is the one failure a long-running job most needs to admit to.
  "timed out",
];

/**
 * Returns a safe, user-facing error message. Internal DB/API errors are
 * replaced with a generic message so stack traces and table names don't leak.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err);
    } catch {
      // fall through
    }
  }
  return String(err);
}

export function toPublicError(err: unknown): string {
  const msg = describeError(err);
  if (PUBLIC_PREFIXES.some((p) => msg.startsWith(p) || msg.includes(p))) return msg;
  // Log the real error server-side before hiding it.
  console.error("[internal-error]", msg);
  return "Something went wrong. Please try again or contact support.";
}
