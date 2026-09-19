/**
 * Retry cover for `ghGet`.
 *
 * Opening a PR reads repo metadata, the base ref and the base commit before it writes anything.
 * None of that was retried, so one transient blip aborted the fix job. The launch verification
 * run reproduced it: 5 of 14 languages failed with a bare "fetch failed" purely from issuing
 * requests back-to-back, and every one succeeded when retried.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ghGet } from "./github";

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "text/json" } });

describe("ghGet retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Runs the call while letting the backoff timers fire immediately.
   *
   * The settled-wrapper matters: awaiting `runAllTimersAsync()` first would leave a rejecting
   * promise unhandled for a tick, which Vitest reports as an unhandled rejection even though
   * the test itself asserts on it.
   */
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    const settled = fn().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const result = await settled;
    if (result.ok) return result.value;
    throw result.error;
  }

  it("retries a bare network failure and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse({ full_name: "o/r" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await run(() => ghGet<{ full_name: string }>("t", "/repos/o/r"));
    expect(result.full_name).toBe("o/r");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 from the secondary rate limiter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await run(() => ghGet("t", "/repos/o/r"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await run(() => ghGet("t", "/repos/o/r"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 404 — that is a real answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(run(() => ghGet("t", "/repos/o/missing"))).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 401 — retrying a bad token just delays the error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad creds", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(run(() => ghGet("t", "/repos/o/r"))).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of attempts", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(run(() => ghGet("t", "/repos/o/r"))).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After when GitHub sends one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await run(() => ghGet("t", "/repos/o/r"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
