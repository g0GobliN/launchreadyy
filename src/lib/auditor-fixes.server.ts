import type { ProjectContext } from "./project-context.server";
import { findStripeWebhookTarget, parseAuditorRoutePath } from "./stripe-webhook-fix.server";

export { STRIPE_WEBHOOK_RE, STRIPE_VERIFY_RE } from "./stripe-webhook-fix.server";
export { parseAuditorRoutePath };
export { DETERMINISTIC_AUDITOR_FIX_IDS } from "./fix-meta";

const VALIDATION_RE =
  /zod|yup|joi|celebrate|express-validator|valibot|superstruct|safeParse|parseAsync|pydantic|BaseModel|@Valid|jakarta\.validation/i;
const AUTH_GUARD_RE =
  /getServerSession|auth\(|requireAuth|isAuthenticated|clerkMiddleware|withAuth|protectedRoute/;
const LOCALHOST_RE = /localhost:\d+|127\.0\.0\.1:\d+/;
const ROUTE_RE =
  /(router\.|app\.(get|post|put|patch|delete)|RouteHandler|export async function (GET|POST|PUT|PATCH|DELETE)|@app\.(get|post)|@router\.(get|post)|@(Get|Post)Mapping)/;

/** Auditor findings LaunchReadyy can fix (excludes subjective TODO cleanup). */
export const AUDITOR_AUTO_FIXABLE = new Set([
  "auditor-stripe-webhook",
  "auditor-env-undocumented",
  "auditor-env-gap",
  "auditor-api-validation",
  "auditor-auth-routes",
  "auditor-prisma-migrations",
  "auditor-localhost-api",
]);

export function isAuditorFixId(fixId: string): boolean {
  return fixId.startsWith("auditor-");
}

type FetchFile = (path: string) => Promise<string | null>;

async function fileContent(
  path: string,
  files: Record<string, string>,
  fetchFile: FetchFile,
): Promise<string | null> {
  if (files[path]) return files[path];
  const content = await fetchFile(path);
  if (content) files[path] = content;
  return content;
}

/** Loads target source files into `files` and sets `__auditor_target` for AI output path. */
export async function enrichFilesForAuditorFix(
  fixId: string,
  ctx: ProjectContext,
  files: Record<string, string>,
  fetchFile: FetchFile,
  opts?: { preferredPath?: string | null },
): Promise<void> {
  const paths = ctx.filePaths;
  const getContent = (p: string) => files[p] ?? null;

  if (fixId === "auditor-stripe-webhook") {
    const target = findStripeWebhookTarget(paths, getContent, opts?.preferredPath);
    if (target) {
      await fileContent(target, files, fetchFile);
      files["__auditor_target"] = target;
    }
    return;
  }

  if (fixId === "auditor-localhost-api") {
    for (const p of paths) {
      if (!/\.(ts|tsx|js|jsx|py|java|env|json)$/.test(p)) continue;
      const content = await fileContent(p, files, fetchFile);
      if (content && LOCALHOST_RE.test(content)) {
        files["__auditor_target"] = p;
        return;
      }
    }
    return;
  }

  if (fixId === "auditor-api-validation") {
    const routeFiles = paths.filter((p) => {
      if (p.endsWith(".py")) {
        return (
          /^(main|app)\.py$/.test(p) ||
          p.includes("/routes/") ||
          p.includes("/api/") ||
          /webhook/i.test(p)
        );
      }
      if (p.endsWith(".java")) {
        return /Controller\.java$/.test(p) || /controller\//i.test(p);
      }
      return (
        SOURCE_EXT.test(p) &&
        (p.includes("/routes/") ||
          p.includes("/api/") ||
          p.endsWith("server.ts") ||
          p.endsWith("server.js"))
      );
    });
    for (const p of routeFiles.slice(0, 20)) {
      const content = await fileContent(p, files, fetchFile);
      if (!content || !ROUTE_RE.test(content) || VALIDATION_RE.test(content)) continue;
      files["__auditor_target"] = p;
      return;
    }
    return;
  }

  if (fixId === "auditor-auth-routes") {
    const authRoutes = paths.filter((p) => /dashboard|admin|settings|account/i.test(p));
    for (const p of authRoutes.slice(0, 15)) {
      const content = await fileContent(p, files, fetchFile);
      if (!content || AUTH_GUARD_RE.test(content)) continue;
      files["__auditor_target"] = p;
      return;
    }
    return;
  }

  if (fixId === "auditor-prisma-migrations") {
    for (const p of ["prisma/schema.prisma", "package.json"]) {
      await fileContent(p, files, fetchFile);
    }
    files["__auditor_target"] = "package.json";
  }
}

const SOURCE_EXT = /\.(tsx?|jsx?|mts|mjs|py|java)$/;

export function auditorOutputPath(fixId: string, files: Record<string, string>): string {
  if (files["__auditor_target"]) return files["__auditor_target"];
  if (fixId === "auditor-prisma-migrations") return "package.json";
  if (fixId === "auditor-env-undocumented" || fixId === "auditor-env-gap") return ".env.example";
  return "src/lib/security-patch.ts";
}
