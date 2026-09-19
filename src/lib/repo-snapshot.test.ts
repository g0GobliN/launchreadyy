import { describe, it, expect, vi, afterEach } from "vitest";
import { getRepoSnapshot, parseTarSnapshot, peekRepoSnapshot } from "./repo-snapshot.server";

// Builds a minimal ustar archive in memory — enough to exercise the parser
// without touching the network.
function tarEntry(name: string, content: string, typeflag = "0"): Uint8Array {
  const body = new TextEncoder().encode(content);
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  header.set(enc.encode(name).subarray(0, 100), 0);
  header.set(enc.encode("0000644\0"), 100);
  header.set(enc.encode("0000000\0"), 108);
  header.set(enc.encode("0000000\0"), 116);
  header.set(enc.encode(body.byteLength.toString(8).padStart(11, "0") + "\0"), 124);
  header.set(enc.encode("00000000000\0"), 136);
  header.set(enc.encode("        "), 148); // checksum spaces during computation
  header[156] = typeflag.charCodeAt(0);
  header.set(enc.encode("ustar\0"), 257);
  header.set(enc.encode("00"), 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);

  const paddedBody = new Uint8Array(Math.ceil(body.byteLength / 512) * 512);
  paddedBody.set(body);
  const out = new Uint8Array(512 + paddedBody.byteLength);
  out.set(header);
  out.set(paddedBody, 512);
  return out;
}

function buildTar(entries: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = entries.reduce((n, e) => n + e.byteLength, 0) + 1024;
  const out = new Uint8Array(total);
  let off = 0;
  for (const e of entries) {
    out.set(e, off);
    off += e.byteLength;
  }
  return out;
}

describe("parseTarSnapshot", () => {
  it("extracts files and strips the repo prefix directory", () => {
    const tar = buildTar([
      tarEntry("owner-repo-abc123/", "", "5"),
      tarEntry("owner-repo-abc123/package.json", '{"name":"x"}'),
      tarEntry("owner-repo-abc123/src/index.ts", "export const a = 1;\n"),
    ]);
    const snap = parseTarSnapshot(tar);
    expect(snap.filePaths).toEqual(["package.json", "src/index.ts"]);
    expect(snap.files.get("package.json")).toBe('{"name":"x"}');
    expect(snap.files.get("src/index.ts")).toBe("export const a = 1;\n");
  });

  it("lists binary files in filePaths but omits their content", () => {
    const bin = String.fromCharCode(0, 1, 2, 3);
    const tar = buildTar([tarEntry("p-r-sha/logo.png", bin)]);
    const snap = parseTarSnapshot(tar);
    expect(snap.filePaths).toEqual(["logo.png"]);
    expect(snap.files.has("logo.png")).toBe(false);
  });

  it("applies pax extended-header path overrides (git archive long paths)", () => {
    const longPath = "p-r-sha/" + "deep/".repeat(25) + "file.ts";
    const record = `path=${longPath}\n`;
    const recLen = record.length + String(record.length + 3).length + 1;
    const paxBody = `${recLen} ${record}`;
    const tar = buildTar([
      tarEntry("p-r-sha/pax-placeholder", paxBody, "x"),
      tarEntry("p-r-sha/truncated-name.ts", "content here"),
    ]);
    const snap = parseTarSnapshot(tar);
    expect(snap.filePaths).toEqual([longPath.slice("p-r-sha/".length)]);
    expect(snap.files.get(longPath.slice("p-r-sha/".length))).toBe("content here");
  });

  it("skips the pax global header emitted by git archive", () => {
    const tar = buildTar([
      tarEntry("pax_global_header", "52 comment=abc\n", "g"),
      tarEntry("p-r-sha/a.txt", "hello"),
    ]);
    const snap = parseTarSnapshot(tar);
    expect(snap.filePaths).toEqual(["a.txt"]);
  });
});

const TTL_MS = 5 * 60_000;

describe("getRepoSnapshot caching", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  /** Serves one gzipped tarball per call, resolving only once `release()` is called. */
  function stubTarballFetch() {
    const tar = buildTar([tarEntry("p-r-sha/a.txt", "hello")]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls = { count: 0 };
    globalThis.fetch = (async () => {
      calls.count++;
      await gate;
      const source = new ReadableStream<BufferSource>({
        start(controller) {
          controller.enqueue(tar);
          controller.close();
        },
      });
      const gz = source.pipeThrough(new CompressionStream("gzip"));
      return new Response(gz, { status: 200 });
    }) as typeof fetch;
    return { calls, release };
  }

  /** Lets a test move the clock without faking timers, which promise gating relies on. */
  function stubClock(start = 0) {
    const clock = { now: start };
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    return clock;
  }

  it("shares one download between callers that overlap", async () => {
    const { calls, release } = stubTarballFetch();
    stubClock();

    const first = getRepoSnapshot("tok", "o/overlap");
    const second = getRepoSnapshot("tok", "o/overlap");
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(calls.count).toBe(1);
    expect(a).toBe(b);
  });

  it("keeps a download that took longer than the TTL — the regression that stalled scans", async () => {
    const { calls, release } = stubTarballFetch();
    const clock = stubClock();

    const inFlight = getRepoSnapshot("tok", "o/slow");
    // A slow connection: the tarball lands well after the TTL would have elapsed. Stamping
    // expiry at request time made the entry arrive already stale, so every later file read
    // started another full download.
    clock.now = 10 * 60_000;
    release();
    await inFlight;

    await getRepoSnapshot("tok", "o/slow");
    expect(calls.count).toBe(1);
  });

  it("refetches once the TTL has elapsed since the download landed", async () => {
    const { calls, release } = stubTarballFetch();
    const clock = stubClock();

    release();
    await getRepoSnapshot("tok", "o/expiring");
    expect(calls.count).toBe(1);

    clock.now = TTL_MS + 1;
    await getRepoSnapshot("tok", "o/expiring");
    expect(calls.count).toBe(2);
  });

  it("peeks null while the download is in flight, and the snapshot once it lands", async () => {
    const { release } = stubTarballFetch();
    stubClock();

    const inFlight = getRepoSnapshot("tok", "o/peeking");
    expect(peekRepoSnapshot("o/peeking")).toBeNull();

    release();
    await inFlight;
    expect(peekRepoSnapshot("o/peeking")?.files.get("a.txt")).toBe("hello");
  });

  it("peeks null once the entry has expired", async () => {
    const { release } = stubTarballFetch();
    const clock = stubClock();

    release();
    await getRepoSnapshot("tok", "o/peek-expiry");
    expect(peekRepoSnapshot("o/peek-expiry")).not.toBeNull();

    clock.now = TTL_MS + 1;
    expect(peekRepoSnapshot("o/peek-expiry")).toBeNull();
  });

  it("drops a failed download so the next caller retries", async () => {
    stubClock();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("network down");
    }) as typeof fetch;

    await expect(getRepoSnapshot("tok", "o/failing")).rejects.toThrow("network down");
    await expect(getRepoSnapshot("tok", "o/failing")).rejects.toThrow("network down");
    expect(calls).toBe(2);
  });
});
