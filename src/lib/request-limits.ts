/**
 * Global request body ceiling.
 *
 * Per-endpoint validators cap individual fields, but nothing stopped a caller from posting a
 * body far larger than any endpoint wants — the server would parse it, and only then would
 * Zod reject it. The parse is the expensive part, so the check has to happen before it.
 *
 * This is a backstop, not the primary control: endpoint validators still own what a given
 * field may contain. This only bounds the worst case for endpoints that forgot one.
 *
 * @see src/lib/request-limits.test.ts
 */

/**
 * 8 MiB. This bounds memory use while leaving room for the application's structured request
 * payloads. Raising it belongs with the endpoint that needs the additional capacity.
 */
export const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

/** Methods that carry a body worth checking. */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function tooLargeResponse(limit = MAX_REQUEST_BODY_BYTES): Response {
  return new Response(`Request body exceeds the ${limit} byte limit.`, {
    status: 413,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Enforce {@link MAX_REQUEST_BODY_BYTES} on `request`.
 *
 * Returns a 413 to send back, or a `Request` to continue with. The returned request may be a
 * rebuilt copy: a chunked body has no `content-length` to check up front, so the only way to
 * know its size is to read it — and a body read once cannot be read again by the handler, so
 * the bytes are reattached to a fresh Request.
 *
 * `oversize` is reported separately from `request` so the caller can log the rejection; a
 * client probing for a body-size ceiling is worth seeing in the server log.
 */
export async function enforceRequestSizeLimit(
  request: Request,
  limit = MAX_REQUEST_BODY_BYTES,
): Promise<{ request: Request; oversize: false } | { request: null; oversize: true }> {
  if (!BODY_METHODS.has(request.method) || !request.body) {
    return { request, oversize: false };
  }

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    // A non-numeric content-length is malformed; let the runtime deal with it rather than
    // treating NaN as "no limit".
    if (Number.isFinite(bytes) && bytes > limit) {
      return { request: null, oversize: true };
    }
    return { request, oversize: false };
  }

  // Chunked / unknown length: read with a hard stop, then hand the bytes back downstream.
  // Bounded by `limit`, so this cannot itself become the memory-exhaustion problem.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { request: null, oversize: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Rebuilt from the original so method, headers, and credentials carry over untouched.
  // Webhook signature checks read the raw bytes, so they must survive this byte-for-byte.
  return {
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      redirect: request.redirect,
      signal: request.signal,
    }),
    oversize: false,
  };
}
