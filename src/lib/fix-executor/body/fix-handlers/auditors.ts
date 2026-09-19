import {
  patchStripeWebhookContent,
  scoreStripeWebhookFile,
  STRIPE_VERIFY_RE,
  STRIPE_WEBHOOK_RE,
} from "../../../stripe-webhook-fix.server";
import { fetchFileContent } from "../../github";
import { ENV_EXAMPLE } from "../shared/constants";
import type { FixCtx } from "../shared/fix-ctx";

export async function handleAuditorStripeWebhook(fx: FixCtx, fixId: string) {
  const {
    token,
    fullName,
    fixIds,
    effectiveFixIds,
    opts,
    framework,
    repoName,
    aiFiles,
    fileMap,
    pkgMods,
    gitignoreAppends,
    readmeSections,
    verificationNotes,
    add,
    note,
    ctx,
    pkgMeta,
    pm,
    repoFilePaths,
    mergedDeps,
    fw,
    javaBasePackage,
    javaApplicationPath,
    addJava,
    kotlinBasePackage,
    kotlinApplicationPath,
    addKotlin,
    ciProfileInput,
    buildCiYaml,
    phpFw,
    rustFwHint,
    rustMiddlewareSrc,
    bundled,
  } = fx;
  const preferred = opts?.auditorTargetPaths?.["auditor-stripe-webhook"] ?? null;
  const centralHandlers = ["server.ts", "server.js", "src/server.ts", "src/server.js"];
  let alreadyVerified = false;
  for (const p of centralHandlers) {
    const central = await fetchFileContent(token, fullName, p);
    if (central && STRIPE_WEBHOOK_RE.test(central) && STRIPE_VERIFY_RE.test(central)) {
      note(fixId, "verified", `Stripe webhooks already verified in ${p} — no route patch needed`);
      alreadyVerified = true;
      break;
    }
  }
  if (!alreadyVerified) {
    const hasGetStripe = ctx.filePaths.some((p) => p.endsWith("stripe.server.ts"));
    const candidates = preferred
      ? [preferred, ...ctx.filePaths.filter((p) => p !== preferred)]
      : ctx.filePaths;
    let patched = false;
    for (const p of candidates) {
      const raw = await fetchFileContent(token, fullName, p);
      if (!raw) continue;
      if (p !== preferred && scoreStripeWebhookFile(p, raw) <= 0) continue;
      const result = patchStripeWebhookContent(raw, { hasGetStripeHelper: hasGetStripe });
      if (result.ok) {
        add(p, result.content);
        note(fixId, "verified", `Added signature verification to ${p}`);
        patched = true;
        break;
      }
    }
    if (!patched) {
      note(
        fixId,
        "warning",
        "Could not find a patchable Stripe webhook route — add constructEvent verification manually",
      );
    }
  }
}

export async function handleAuditorEnvGap(fx: FixCtx, fixId: string) {
  const {
    token,
    fullName,
    fixIds,
    effectiveFixIds,
    opts,
    framework,
    repoName,
    aiFiles,
    fileMap,
    pkgMods,
    gitignoreAppends,
    readmeSections,
    verificationNotes,
    add,
    note,
    ctx,
    pkgMeta,
    pm,
    repoFilePaths,
    mergedDeps,
    fw,
    javaBasePackage,
    javaApplicationPath,
    addJava,
    kotlinBasePackage,
    kotlinApplicationPath,
    addKotlin,
    ciProfileInput,
    buildCiYaml,
    phpFw,
    rustFwHint,
    rustMiddlewareSrc,
    bundled,
  } = fx;
  const envVars = ctx.envVars;
  const existing = await fetchFileContent(token, fullName, ".env.example").catch(() => null);
  if (existing) {
    const missing = envVars.filter((v) => !existing.includes(v));
    if (missing.length > 0) {
      add(
        ".env.example",
        existing.trimEnd() + "\n" + missing.map((v) => `${v}=`).join("\n") + "\n",
      );
      note(fixId, "verified", `Added ${missing.length} missing variable(s) to .env.example`);
    } else {
      note(fixId, "verified", ".env.example already documents all detected variables");
    }
  } else {
    const lines =
      envVars.length > 0
        ? ["# Copy to .env and fill in", ...envVars.map((v) => `${v}=`)]
        : ENV_EXAMPLE.trim().split("\n");
    add(".env.example", lines.join("\n") + "\n");
    note(fixId, "verified", `Created .env.example with ${envVars.length || "standard"} variables`);
  }
}
