/**
 * One-shot repo snapshot via GitHub's tarball endpoint.
 *
 * The fix preview/generation pipeline reads dozens-to-hundreds of files per request. Fetching
 * them one-by-one through the contents API costs one subrequest each (447 observed on a real
 * repo), which creates excessive GitHub API traffic long
 * before the work is done. Downloading the repo tarball is ONE subrequest for every file at
 * once — and every speculative "does this manifest exist?" probe becomes a free Map lookup
 * instead of a 404 round-trip.
 */

const GITHUB_API = "https://api.github.com";

// Parity with the contents API, which refuses files >1MB (those returned null before too).
const MAX_FILE_BYTES = 1024 * 1024;
// Safety valve for pathological repos — beyond this we bail and callers fall back per-file.
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

export interface RepoSnapshot {
  /** Every regular-file path in the repo, including binary/oversized ones (content omitted). */
  filePaths: string[];
  /** Text content by path — binary and >1MB files are listed in filePaths but absent here. */
  files: Map<string, string>;
}

/** `expiresAt: null` means the download is still in flight — such an entry never expires. */
type CacheEntry = {
  promise: Promise<RepoSnapshot>;
  expiresAt: number | null;
  /** Set on resolve, so callers can ask whether the tarball is here *without* waiting for it. */
  value: RepoSnapshot | null;
};
const snapshotCache = new Map<string, CacheEntry>();
// Longer than a full scan takes. The TTL is measured from when the tarball LANDS (see below),
// so this is genuinely "how stale may the data we hold be", not "how long may downloading take".
const SNAPSHOT_TTL_MS = 5 * 60_000;

/**
 * One tarball per repo per TTL, shared by every caller.
 *
 * The expiry is stamped when the download settles, not when it starts. Stamping at the start
 * meant a download slower than the TTL was born expired: the scanner reads a few hundred files
 * through `snapshotFile`, so every read after the first kicked off *another* full-repo download
 * and the scan never finished. In-flight entries are reused unconditionally for the same reason —
 * two callers must never race two downloads of the same repo.
 */
export async function getRepoSnapshot(token: string, fullName: string): Promise<RepoSnapshot> {
  const cached = snapshotCache.get(fullName);
  if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) return cached.promise;

  const entry: CacheEntry = {
    promise: fetchSnapshot(token, fullName),
    expiresAt: null,
    value: null,
  };
  snapshotCache.set(fullName, entry);
  entry.promise.then(
    (snapshot) => {
      entry.value = snapshot;
      entry.expiresAt = Date.now() + SNAPSHOT_TTL_MS;
    },
    () => {
      // Only evict ourselves — a later attempt may already own the slot.
      if (snapshotCache.get(fullName) === entry) snapshotCache.delete(fullName);
    },
  );
  return entry.promise;
}

/**
 * The snapshot only if it is already downloaded. Never starts a download, never waits.
 *
 * For a caller that needs two or three files, waiting on a whole-repo tarball is the wrong
 * trade — on a slow connection it is minutes of silence before any work can start.
 */
export function peekRepoSnapshot(fullName: string): RepoSnapshot | null {
  const entry = snapshotCache.get(fullName);
  if (!entry || entry.expiresAt === null || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

/** Start the download without waiting for it, so a later bulk reader finds it ready. */
export function warmRepoSnapshot(token: string, fullName: string): void {
  void getRepoSnapshot(token, fullName).catch(() => {});
}

/**
 * Snapshot-first file read: resolves from the tarball when possible; if the snapshot itself
 * failed (rate limit, huge repo, empty repo), falls back to the caller-supplied per-file
 * fetcher so behavior degrades to exactly what shipped before this module existed.
 */
export async function snapshotFile(
  token: string,
  fullName: string,
  path: string,
  fallback: (token: string, fullName: string, path: string) => Promise<string | null>,
): Promise<string | null> {
  try {
    const snap = await getRepoSnapshot(token, fullName);
    return snap.files.get(path) ?? null;
  } catch {
    return fallback(token, fullName, path);
  }
}

async function fetchSnapshot(token: string, fullName: string): Promise<RepoSnapshot> {
  const res = await fetch(`${GITHUB_API}/repos/${fullName}/tarball`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LaunchReadyy/1.0",
    },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    throw new Error(`tarball fetch failed: ${res.status}`);
  }

  const gunzip = res.body.pipeThrough(new DecompressionStream("gzip"));
  const buf = new Uint8Array(await new Response(gunzip).arrayBuffer());
  if (buf.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`repo archive too large: ${buf.byteLength} bytes`);
  }
  return parseTarSnapshot(buf);
}

function octal(buf: Uint8Array, off: number, len: number): number {
  let s = "";
  for (let i = off; i < off + len; i++) {
    const c = buf[i];
    if (c === 0 || c === 32) break;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
}

function str(buf: Uint8Array, off: number, len: number): string {
  let end = off;
  while (end < off + len && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(off, end));
}

function isZeroBlock(buf: Uint8Array, off: number): boolean {
  for (let i = off; i < off + 512; i++) if (buf[i] !== 0) return false;
  return true;
}

/** Parses a pax extended header body: series of "<len> <key>=<value>\n" records. */
function paxPath(body: Uint8Array): string | null {
  const text = new TextDecoder().decode(body);
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(" ", i);
    if (sp === -1) break;
    const recLen = parseInt(text.slice(i, sp), 10);
    if (!recLen || recLen <= 0) break;
    const rec = text.slice(sp + 1, i + recLen - 1); // drop trailing \n
    const eq = rec.indexOf("=");
    if (eq !== -1 && rec.slice(0, eq) === "path") return rec.slice(eq + 1);
    i += recLen;
  }
  return null;
}

export function parseTarSnapshot(buf: Uint8Array): RepoSnapshot {
  const filePaths: string[] = [];
  const files = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: false });

  let off = 0;
  let pendingLongName: string | null = null;
  let pendingPaxPath: string | null = null;

  while (off + 512 <= buf.byteLength) {
    if (isZeroBlock(buf, off)) break;

    const entrySize = octal(buf, off + 124, 12);
    const typeflag = String.fromCharCode(buf[off + 156]);
    let name = str(buf, off, 100);
    const prefix = str(buf, off + 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (pendingLongName) {
      name = pendingLongName;
      pendingLongName = null;
    }
    if (pendingPaxPath) {
      name = pendingPaxPath;
      pendingPaxPath = null;
    }

    const body = buf.subarray(off + 512, off + 512 + entrySize);
    const padded = 512 + Math.ceil(entrySize / 512) * 512;

    if (typeflag === "L") {
      pendingLongName = str(body, 0, body.byteLength);
    } else if (typeflag === "x") {
      pendingPaxPath = paxPath(body);
    } else if (typeflag === "0" || typeflag === "\0") {
      // GitHub tarballs prefix every path with "<owner>-<repo>-<sha>/" — strip it.
      const slash = name.indexOf("/");
      const rel = slash === -1 ? "" : name.slice(slash + 1);
      if (rel) {
        filePaths.push(rel);
        if (entrySize <= MAX_FILE_BYTES && !hasNulByte(body)) {
          files.set(rel, decoder.decode(body));
        }
      }
    }
    // 'g' (pax global), '5' (dir), '2' (symlink) etc.: skip body, nothing to record.

    off += padded;
  }

  return { filePaths, files };
}

function hasNulByte(body: Uint8Array): boolean {
  // Sampling the first 8KB is enough to classify binaries without scanning huge files.
  const limit = Math.min(body.byteLength, 8192);
  for (let i = 0; i < limit; i++) if (body[i] === 0) return true;
  return false;
}

/** @internal test helper */
export function clearSnapshotCacheForTests(): void {
  snapshotCache.clear();
}
