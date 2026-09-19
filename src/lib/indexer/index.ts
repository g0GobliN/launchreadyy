/**
 * Repository indexer — TypeScript reference implementation (v2 Phase 5).
 *
 * Fast, allocation-light indexing: per-file hash/size/line-count plus a bounded secret-candidate
 * pre-filter. This is the production path; the Rust/WASM crate in `rust/crates/indexer` is a
 * drop-in accelerator (identical FNV-1a hashes) selected by `flag_rust_indexer` when its artifact is
 * present. Keeping a TS reference means the feature always works, even with no Rust build.
 *
 * @see docs/README.md  (Phase 5)
 * @see rust/crates/indexer/src/lib.rs
 */

import { hashContent } from "../scan-engine/incremental";

export interface FileMeta {
  path: string;
  hash: string;
  size: number;
  lines: number;
}

export interface RepoIndex {
  files: FileMeta[];
  totalBytes: number;
  totalLines: number;
}

export interface SourceFile {
  path: string;
  content: string;
}

/** Backend contract shared by the TS reference and the future Rust/WASM accelerator. */
export interface Indexer {
  readonly id: string;
  index(files: SourceFile[]): RepoIndex;
}

// Kept in lockstep with the Rust `traversal::should_index` so the TS and Rust indexers produce an
// identical file set — a prerequisite for the accelerator being a true drop-in replacement.
const SKIP_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "vendor",
  "coverage",
  ".turbo",
  ".cache",
  "__pycache__",
];
const SKIP_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp4",
  "mov",
  "webm",
  "mp3",
  "wav",
  "pdf",
  "zip",
  "gz",
  "tar",
  "map",
  "wasm",
  "bin",
  "exe",
  "dll",
  "so",
  "dylib",
  "lock",
]);

function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

/** Whether a repo-relative path should be indexed. Mirrors `traversal::should_index` in the crate. */
export function shouldIndexFile(path: string): boolean {
  const lower = path.toLowerCase();
  for (const dir of SKIP_DIRS) {
    if (lower === dir || lower.startsWith(`${dir}/`) || lower.includes(`/${dir}/`)) return false;
  }
  if (lower.endsWith(".min.js") || lower.endsWith(".min.css")) return false;
  const ext = extensionOf(lower);
  if (ext && SKIP_EXTS.has(ext)) return false;
  return true;
}

const ENCODER = new TextEncoder();
/** UTF-8 byte length — matches Rust `String::len()` so `size`/`totalBytes` agree across backends. */
function byteLength(content: string): number {
  return ENCODER.encode(content).length;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  // A trailing newline shouldn't inflate the count beyond the Rust `lines()` semantics.
  return content.endsWith("\n") ? lines - 1 : lines;
}

export function indexRepository(files: SourceFile[]): RepoIndex {
  const metas: FileMeta[] = [];
  let totalBytes = 0;
  let totalLines = 0;
  for (const f of files) {
    if (!shouldIndexFile(f.path)) continue;
    const size = byteLength(f.content);
    const lines = countLines(f.content);
    totalBytes += size;
    totalLines += lines;
    metas.push({ path: f.path, hash: hashContent(f.content), size, lines });
  }
  return { files: metas, totalBytes, totalLines };
}

export const tsIndexer: Indexer = {
  id: "ts-reference",
  index: indexRepository,
};

/** A high-signal secret candidate found by the fast pre-filter (refined by the full secret scanner). */
export interface SecretCandidate {
  path: string;
  line: number;
  kind: string;
}

/** Bounded, high-signal patterns — a pre-filter, not the authoritative secret scanner. */
const SECRET_PREFILTER: { kind: string; re: RegExp }[] = [
  { kind: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { kind: "stripe-secret-key", re: /sk_live_[0-9a-zA-Z]{20,}/ },
  { kind: "github-token", re: /gh[pousr]_[0-9A-Za-z]{20,}/ },
  { kind: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: "generic-bearer", re: /bearer\s+[a-z0-9._-]{20,}/i },
];

/**
 * Sweep files for likely secrets. Fast, line-oriented, and capped so a huge repo can't stall the
 * pass; the results are candidates the full `scanner/security/secrets` check verifies and reports.
 */
export function sweepSecretCandidates(
  files: SourceFile[],
  opts: { maxPerFile?: number } = {},
): SecretCandidate[] {
  const maxPerFile = opts.maxPerFile ?? 20;
  const out: SecretCandidate[] = [];
  for (const f of files) {
    let found = 0;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length && found < maxPerFile; i++) {
      for (const { kind, re } of SECRET_PREFILTER) {
        if (re.test(lines[i])) {
          out.push({ path: f.path, line: i + 1, kind });
          found++;
          break;
        }
      }
    }
  }
  return out;
}
