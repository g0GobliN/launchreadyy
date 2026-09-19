export const STRIPE_WEBHOOK_RE = /webhook|stripe.*route|route.*stripe/i;
// `events.retrieve`/`Event.retrieve` is Stripe's documented pre-signature verification
// alternative: re-fetching the posted event by ID from Stripe's API means a forged payload
// can't inject attacker-controlled data. Confirmed against two real webhook servers
// (ruffrey/stripe-webhook-server, eddywashere/stripe-webhook-middleware) that verify exactly
// this way and were being flagged "critical" as unverified.
export const STRIPE_VERIFY_RE =
  /constructEvent|webhooks\.constructEvent|stripe\.webhooks\.constructEvent|construct_event|Webhook\.construct_event|Webhook\.constructEvent|events\.retrieve|Event\.retrieve/;

const SOURCE_EXT = /\.(tsx?|jsx?|mts|mjs|py|java)$/;
const SKIP_PATH_RE =
  /fix-packs|mock-data|demo-scans|enrich-finding|checklist|auditor-fixes|\.test\.|\.spec\.|__tests__|node_modules/i;
const HANDLER_RE =
  /export async function POST|export function POST|app\.post\s*\(|router\.post\s*\(|handleStripeWebhook|handleWebhook|@app\.post|@router\.post|def\s+\w*webhook|@PostMapping|@RequestMapping/i;

/** Parse flagged file path from auditor issue copy: "Route src/foo.ts handles …" */
export function parseAuditorRoutePath(why: string): string | null {
  const m = why.match(/Route ([^\s]+) handles/);
  return m?.[1] ?? null;
}

export function scoreStripeWebhookFile(path: string, content: string): number {
  if (!SOURCE_EXT.test(path) || SKIP_PATH_RE.test(path)) return -1;
  if (STRIPE_VERIFY_RE.test(content)) return -1;

  let score = 0;
  if (/\/webhook/i.test(path)) score += 60;
  if (/\/stripe/i.test(path) || /stripe.*route/i.test(path)) score += 40;
  if (/(^|\/)api\//.test(path)) score += 25;
  if (/server\.(ts|js)$/.test(path)) score += 30;
  if (/webhook.*\.py$|stripe.*\.py$/i.test(path)) score += 50;
  if (/Webhook.*\.java$|Stripe.*Controller\.java$/i.test(path)) score += 50;
  if (HANDLER_RE.test(content)) score += 45;
  if (
    /stripe-signature|headers\.get\(['"]stripe-signature|Stripe-Signature|HTTP_STRIPE_SIGNATURE/i.test(
      content,
    )
  )
    score += 35;
  if (/from ['"]stripe['"]|require\(['"]stripe['"]\)|import stripe|com\.stripe/.test(content))
    score += 20;

  // Path-based "webhook mention" must require the literal word — the `stripe.*route` limb of
  // STRIPE_WEBHOOK_RE exists for content like "// stripe webhook route handler", but against a
  // Next.js App Router PATH it matches every stripe-adjacent endpoint (all App Router files are
  // literally named route.ts). Confirmed on the real shadcn/taxonomy: its GET-only, session-
  // guarded billing route at app/api/users/stripe/route.ts was flagged as an unverified webhook
  // while its actual webhook (app/api/webhooks/stripe/route.ts) verifies correctly.
  const head = content.slice(0, 1200);
  const mentionsWebhook = /webhook/i.test(path) || STRIPE_WEBHOOK_RE.test(head);
  if (!mentionsWebhook) return -1;
  // Stripe only delivers webhooks via POST — a file with no recognizable POST/handler shape and
  // no "webhook" in its path cannot be a webhook receiver, so disqualify instead of just
  // penalizing (the old -50 hedge still left taxonomy's billing route above zero).
  if (!HANDLER_RE.test(content) && !/\/webhook/i.test(path)) return -1;

  return score;
}

export function findStripeWebhookTarget(
  paths: string[],
  getContent: (p: string) => string | null | undefined,
  preferredPath?: string | null,
): string | null {
  if (preferredPath) {
    const preferredContent = getContent(preferredPath);
    if (preferredContent && scoreStripeWebhookFile(preferredPath, preferredContent) > 0) {
      return preferredPath;
    }
  }

  let best: { path: string; score: number } | null = null;
  for (const p of paths) {
    const content = getContent(p);
    if (!content) continue;
    const score = scoreStripeWebhookFile(p, content);
    if (score > 0 && (!best || score > best.score)) best = { path: p, score };
  }
  return best?.path ?? null;
}

function verificationBlock(indent: string, hasGetStripeHelper: boolean, bodyVar?: string): string {
  const client = hasGetStripeHelper
    ? `${indent}const { getStripe } = await import("./lib/stripe.server");\n${indent}const stripe = getStripe();`
    : `${indent}const stripe = new (await import("stripe")).default(process.env.STRIPE_SECRET_KEY!, {\n${indent}  apiVersion: "2024-11-20.acacia",\n${indent}});`;

  const bodyLine = bodyVar
    ? `${indent}const ${bodyVar} = event.data.object;`
    : `${indent}// Use \`event\` for the verified Stripe webhook payload below`;

  return `${indent}// Stripe webhook signature verification (LaunchReadyy)
${indent}const sig = request.headers.get("stripe-signature");
${indent}const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
${indent}if (!webhookSecret || !sig) {
${indent}  return new Response("Webhook not configured", { status: 400 });
${indent}}
${indent}const rawBody = await request.text();
${client}
${indent}let event;
${indent}try {
${indent}  event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
${indent}} catch {
${indent}  return new Response("Invalid signature", { status: 400 });
${indent}}
${bodyLine}`;
}

/** Patches a Request-handler webhook route to verify signatures before processing. */
export function patchStripeWebhookContent(
  content: string,
  opts?: { hasGetStripeHelper?: boolean },
): { content: string; ok: true } | { ok: false; reason: string } {
  if (STRIPE_VERIFY_RE.test(content)) {
    return { ok: false, reason: "Signature verification already present" };
  }

  const jsonHandler = content.match(/^(\s*)const (\w+) = await request\.json\(\)\s*;?\s*$/m);
  if (jsonHandler) {
    const indent = jsonHandler[1] ?? "  ";
    const varName = jsonHandler[2] ?? "body";
    const block = verificationBlock(indent, opts?.hasGetStripeHelper ?? false, varName);
    return { content: content.replace(jsonHandler[0], block), ok: true };
  }

  const postFn = content.match(
    /export async function POST\s*\(\s*(?:request|req):\s*Request\s*\)\s*\{/,
  );
  if (postFn && postFn.index !== undefined) {
    const insertAt = postFn.index + postFn[0].length;
    const block = `\n${verificationBlock("  ", opts?.hasGetStripeHelper ?? false)}\n`;
    return { content: content.slice(0, insertAt) + block + content.slice(insertAt), ok: true };
  }

  return { ok: false, reason: "No patchable POST webhook handler found" };
}
