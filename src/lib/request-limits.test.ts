import { describe, expect, it } from "vitest";

import {
  MAX_REQUEST_BODY_BYTES,
  enforceRequestSizeLimit,
  tooLargeResponse,
} from "./request-limits";

/** A body with no `content-length`, which is what forces the streaming path. */
function chunkedRequest(chunks: Uint8Array[], method = "POST"): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("https://example.test/api", {
    method,
    body: stream,
    // Required by undici when the body is a stream.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("enforceRequestSizeLimit", () => {
  it("passes through requests with no body", async () => {
    const request = new Request("https://example.test/", { method: "GET" });
    const result = await enforceRequestSizeLimit(request);
    expect(result.oversize).toBe(false);
    expect(result.request).toBe(request);
  });

  it("rejects an oversized body on content-length alone, without reading it", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
      body: "x",
    });

    const result = await enforceRequestSizeLimit(request);

    expect(result.oversize).toBe(true);
    // The point of the header check: the body is still untouched.
    expect(request.bodyUsed).toBe(false);
  });

  it("allows a body exactly at the limit", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      headers: { "content-length": String(MAX_REQUEST_BODY_BYTES) },
      body: "x",
    });
    expect((await enforceRequestSizeLimit(request)).oversize).toBe(false);
  });

  it("ignores a malformed content-length rather than treating it as unlimited", async () => {
    const request = new Request("https://example.test/api", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
      body: "hello",
    });
    // NaN must not compare as "over the limit" and must not be trusted as "under" it either;
    // the request continues and the runtime deals with the malformed header.
    expect((await enforceRequestSizeLimit(request)).oversize).toBe(false);
  });

  it("rejects a chunked body that exceeds the limit", async () => {
    const limit = 1_000;
    const result = await enforceRequestSizeLimit(
      chunkedRequest([new Uint8Array(600), new Uint8Array(600)]),
      limit,
    );
    expect(result.oversize).toBe(true);
    expect(result.request).toBeNull();
  });

  it("stops reading as soon as a chunked body crosses the limit", async () => {
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced++;
        controller.enqueue(new Uint8Array(500));
      },
    });
    const request = new Request("https://example.test/api", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const result = await enforceRequestSizeLimit(request, 1_000);

    expect(result.oversize).toBe(true);
    // An unbounded producer must not be drained — that would be the very exhaustion this guards.
    expect(produced).toBeLessThan(10);
  });

  it("returns a chunked body's bytes intact so the handler can still read them", async () => {
    const payload = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    const result = await enforceRequestSizeLimit(
      chunkedRequest([payload.slice(0, 5), payload.slice(5)]),
      1_000,
    );

    expect(result.oversize).toBe(false);
    // Byte-for-byte: the Stripe webhook verifies a signature over exactly these bytes.
    expect(await result.request!.text()).toBe(JSON.stringify({ hello: "world" }));
  });

  it("preserves method and headers when rebuilding a chunked request", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const request = new Request("https://example.test/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=abc" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const result = await enforceRequestSizeLimit(request, 1_000);

    expect(result.request!.method).toBe("POST");
    expect(result.request!.headers.get("stripe-signature")).toBe("t=1,v1=abc");
    expect(result.request!.url).toBe("https://example.test/api/stripe/webhook");
  });

  it("does not read bodies on methods that should not carry one", async () => {
    const request = new Request("https://example.test/", { method: "GET" });
    const result = await enforceRequestSizeLimit(request, 1);
    expect(result.oversize).toBe(false);
  });
});

describe("tooLargeResponse", () => {
  it("is a 413 that names the limit", async () => {
    const response = tooLargeResponse();
    expect(response.status).toBe(413);
    expect(await response.text()).toContain(String(MAX_REQUEST_BODY_BYTES));
  });
});

describe("MAX_REQUEST_BODY_BYTES", () => {
  it("stays above the largest body any endpoint accepts", () => {
    // uploadFeedbackScreenshotFn caps dataBase64 at 7,000,000 characters. If that grows past
    // this ceiling, uploads start failing at the edge with a confusing 413 instead of a
    // validation error — so the two limits have to move together.
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(7_000_000);
  });
});
