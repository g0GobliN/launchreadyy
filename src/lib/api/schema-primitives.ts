/**
 * Shared input primitives for server-function validators.
 *
 * Every string that arrives from a client needs an upper bound. Writing `.max()` by hand at
 * each call site means the bound is only as good as the author remembering it — and the
 * fields that get forgotten are the boring ones (`repoId`, `jobId`) that appear dozens of
 * times. These primitives make the bound the default and the omission the deliberate act.
 *
 * The global body cap in `src/lib/request-limits.ts` bounds the request as a whole; these
 * bound each field within it, which is what keeps an oversized value out of a database
 * column, an AI prompt, or a GitHub API call.
 *
 * Sizes are deliberately generous — they exist to make abuse impossible, not to enforce
 * product rules. A field with a real domain limit should say so at its own call site.
 *
 * @see src/lib/api/schema-primitives.test.ts
 */

import { z } from "zod";

/**
 * Internal identifiers: UUIDs, Stripe object IDs, job and run IDs.
 *
 * Not `.uuid()` — the same primitive covers Stripe's `sub_…`/`pi_…` and our own prefixed
 * IDs, and a lookup with a well-formed but unknown ID already fails safely at the query.
 * The bound is what matters here.
 */
export const idString = z.string().min(1).max(128);

/** Optional variant of {@link idString}, for filters and nullable references. */
export const optionalIdString = idString.optional();

/** Enum-like values arriving as free strings: filter names, plan slugs, status values. */
export const slugString = z.string().max(64);

/** A GitHub username. GitHub caps these at 39 characters. */
export const githubLoginString = z.string().min(1).max(39);

/** Single-line human text: titles, search queries, labels. */
export const shortText = z.string().max(200);

/** Multi-line human text: notes, reasons, descriptions. */
export const mediumText = z.string().max(2_000);

/**
 * Long human or model-facing text: feedback passed into a prompt, evidence blobs.
 *
 * Anything larger than this belongs in storage with a reference passed instead, the way
 * feedback screenshots already work.
 */
export const longText = z.string().max(20_000);

/** A URL supplied by the client. Bounded well above real URLs, which stay under 2 KB. */
export const urlString = z.string().max(2_048);

/** A hostname supplied by the client. 253 is the DNS maximum. */
export const domainString = z.string().min(1).max(253);
