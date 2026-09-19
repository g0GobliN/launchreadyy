/** Max text file size scanned — parity with GitHub contents API / repo tarball parser. */
export const MAX_SCAN_FILE_BYTES = 1024 * 1024;

export interface FileProvider {
  listFiles(): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
}

/** Optional metadata some providers expose (GitHub tree sizes, truncation). */
export interface FileProviderMeta {
  treeTruncated?: boolean;
  fileSize(path: string): number | undefined;
  /** Git blob SHA per path — a free, stable content hash used for incremental scans (Phase 3). */
  fileHashes?(): Record<string, string>;
  /** The tree SHA identifying overall repo state at scan time (Phase 3). */
  treeSha?(): string | undefined;
}

export type RichFileProvider = FileProvider & FileProviderMeta;

export function sampleHasNulByte(data: Uint8Array): boolean {
  const limit = Math.min(data.byteLength, 8192);
  for (let i = 0; i < limit; i++) if (data[i] === 0) return true;
  return false;
}

export function isTextFileContent(data: Uint8Array, byteLength: number): boolean {
  return byteLength <= MAX_SCAN_FILE_BYTES && !sampleHasNulByte(data);
}
