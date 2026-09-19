import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped context for the local Node server.
 *
 * One AsyncLocalStorage per process: the server entry seeds it with the client IP
 * and a scratch cache per request; background work (worker ticks, tests) runs
 * outside it and callers must treat absent context as "do the work".
 */
interface RequestContext {
  clientIp: string;
  /**
   * Scratch space that lives exactly as long as one request, for lookups that would
   * otherwise repeat within it. Created lazily by {@link getRequestScopedCache}.
   *
   * Deliberately request-scoped rather than module-scoped: a long-lived process serves
   * many requests, and a cache that outlived the request would be one where a changed
   * answer could still be shadowed by an earlier request's value.
   */
  cache?: Map<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getClientIp(): string {
  return storage.getStore()?.clientIp ?? "unknown";
}

/**
 * Per-request memo store, or `undefined` outside a request (worker ticks, queue
 * consumers, tests). Callers must treat the absent case as "do the work" rather than
 * failing — nothing here is required for correctness, only for avoiding repeat lookups.
 */
export function getRequestScopedCache(): Map<string, unknown> | undefined {
  const ctx = storage.getStore();
  if (!ctx) return undefined;
  ctx.cache ??= new Map();
  return ctx.cache;
}
