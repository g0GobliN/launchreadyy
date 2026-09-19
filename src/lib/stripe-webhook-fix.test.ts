import { describe, expect, it } from "vitest";
import {
  findStripeWebhookTarget,
  parseAuditorRoutePath,
  patchStripeWebhookContent,
  scoreStripeWebhookFile,
} from "./stripe-webhook-fix.server";

describe("parseAuditorRoutePath", () => {
  it("extracts route from issue why text", () => {
    expect(
      parseAuditorRoutePath(
        "Route app/api/stripe/webhook/route.ts handles Stripe webhooks but no constructEvent",
      ),
    ).toBe("app/api/stripe/webhook/route.ts");
  });
});

describe("scoreStripeWebhookFile", () => {
  it("rejects fix-packs.ts comment-only webhook mention", () => {
    const content = `/** Fix packs bundle related fixes */
export const FIX_PACKS = [{ description: "webhook signature verification manual step" }];`;
    expect(scoreStripeWebhookFile("src/lib/fix-packs.ts", content)).toBeLessThan(0);
  });

  it("prefers real webhook route handlers", () => {
    const route = `export async function POST(request: Request) {
  const body = await request.json();
  await handle(body);
}`;
    expect(scoreStripeWebhookFile("app/api/stripe/webhook/route.ts", route)).toBeGreaterThan(50);
  });

  // Confirmed against the real shadcn/taxonomy: its GET-only, session-guarded billing route
  // (app/api/users/stripe/route.ts — creates checkout/portal sessions, receives no webhook
  // traffic) was flagged as an unverified webhook purely because the App Router path
  // ".../stripe/route.ts" matched the `stripe.*route` limb of STRIPE_WEBHOOK_RE.
  it("rejects a GET-only App Router stripe billing route (not a webhook)", () => {
    const billing = `import { getServerSession } from "next-auth/next"
import { stripe } from "@/lib/stripe"

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return new Response(null, { status: 403 })
  const stripeSession = await stripe.checkout.sessions.create({ mode: "subscription" })
  return new Response(JSON.stringify({ url: stripeSession.url }))
}`;
    expect(scoreStripeWebhookFile("app/api/users/stripe/route.ts", billing)).toBeLessThan(0);
  });

  it("rejects a POST checkout-session App Router route (stripe path but not a webhook)", () => {
    const checkout = `import { stripe } from "@/lib/stripe"

export async function POST(req: Request) {
  const stripeSession = await stripe.checkout.sessions.create({ mode: "payment" })
  return new Response(JSON.stringify({ url: stripeSession.url }))
}`;
    expect(scoreStripeWebhookFile("app/api/stripe/checkout/route.ts", checkout)).toBeLessThan(0);
  });
});

describe("findStripeWebhookTarget", () => {
  it("picks webhook route over fix-packs", () => {
    const files: Record<string, string> = {
      "src/lib/fix-packs.ts": `export const x = "webhook signature verification";`,
      "app/api/stripe/webhook/route.ts": `export async function POST(request: Request) {
  const body = await request.json();
}`,
    };
    expect(findStripeWebhookTarget(Object.keys(files), (p) => files[p])).toBe(
      "app/api/stripe/webhook/route.ts",
    );
  });
});

describe("patchStripeWebhookContent", () => {
  it("replaces request.json() with verified event flow", () => {
    const before = `export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: true });
}`;
    const result = patchStripeWebhookContent(before, { hasGetStripeHelper: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("constructEventAsync");
    expect(result.content).toContain("stripe-signature");
    expect(result.content).not.toContain("await request.json()");
  });
});
