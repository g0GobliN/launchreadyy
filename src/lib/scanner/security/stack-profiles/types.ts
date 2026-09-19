import type { Signal } from "../signals";

/**
 * Stack profiles are capability objects — optional detectors per concern.
 * When a profile's detector is present → framework-aware signal (high confidence).
 * When absent → caller falls back to generic heuristics (medium confidence).
 */
export interface SecurityScanProfileCtx {
  files: string[];
  fileContents: Record<string, string>;
  deps: Record<string, string>;
  sourceContent?: string;
}

export interface StackProfile {
  id: string;
  label: string;
  match: (ctx: SecurityScanProfileCtx) => boolean;
  authDetector?: (ctx: SecurityScanProfileCtx) => Signal[];
  corsDetector?: (ctx: SecurityScanProfileCtx) => Signal[];
  headersDetector?: (ctx: SecurityScanProfileCtx) => Signal[];
  cookieDetector?: (ctx: SecurityScanProfileCtx) => Signal[];
  csrfDetector?: (ctx: SecurityScanProfileCtx) => Signal[];
}

export function pickStackProfile(
  profiles: StackProfile[],
  ctx: SecurityScanProfileCtx,
): StackProfile | null {
  return profiles.find((p) => p.match(ctx)) ?? null;
}
