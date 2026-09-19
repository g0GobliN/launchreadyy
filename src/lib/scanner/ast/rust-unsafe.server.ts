/**
 * Native Rust unsafe-call extraction bridge. Invokes `lr-indexer --unsafe-calls`.
 *
 * Returns only files the AST path handled (parsed). Omitted paths fall through to the TS
 * `findUnsafeCalls` / regex path — same contract as the Rust side.
 *
 * Never throws: missing binary / bad output → null.
 */

import { spawnSync } from "node:child_process";
import { rustIndexerBinary } from "../../indexer/rust-backend.server";
import type { UnsafeCallHit } from "./rules/unsafe-calls";

export interface FileUnsafeCalls {
  path: string;
  hits: UnsafeCallHit[];
}

function isHit(value: unknown): value is UnsafeCallHit {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.label === "string" && typeof v.callee === "string" && typeof v.line === "number";
}

function isFileUnsafe(value: unknown): value is FileUnsafeCalls {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === "string" && Array.isArray(v.hits) && v.hits.every(isHit);
}

export function rustExtractUnsafeCalls(
  files: { path: string; content: string }[],
): FileUnsafeCalls[] | null {
  const bin = rustIndexerBinary();
  if (!bin) return null;
  try {
    const res = spawnSync(bin, ["--unsafe-calls"], {
      input: JSON.stringify(files),
      maxBuffer: 512 * 1024 * 1024,
      encoding: "utf-8",
    });
    if (res.status !== 0 || !res.stdout) return null;
    const parsed: unknown = JSON.parse(res.stdout);
    if (!Array.isArray(parsed) || !parsed.every(isFileUnsafe)) return null;
    return parsed;
  } catch {
    return null;
  }
}
