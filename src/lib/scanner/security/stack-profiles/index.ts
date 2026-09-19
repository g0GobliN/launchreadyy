import type { IssueInput } from "../../../scanner-rules";
import { checkAuthGuardsWithProfile } from "../auth-guards";
import { checkCookiesWithProfile } from "../cookies";
import { checkCsrfWithProfile } from "../csrf";
import { checkCorsWithProfile } from "../cors";
import { checkHeadersWithProfile } from "../security-headers";
import { expressProfile } from "./express";
import { nextProfile } from "./nextjs";
import { djangoProfile } from "./django";
import { fastapiProfile } from "./fastapi";
import { railsProfile } from "./rails";
import { laravelProfile } from "./laravel";
import { viteProfile } from "./vite";
import { goProfile } from "./go";
import { astroProfile } from "./astro";
import { isNonShippingPath, shippingContents } from "../../non-shipping-paths";
import { pickStackProfile, type SecurityScanProfileCtx, type StackProfile } from "./types";

export type { StackProfile, SecurityScanProfileCtx };
export { pickStackProfile } from "./types";

/** Prefer specific frameworks first (Next/Astro before Vite, Django before generic Python). */
const PROFILES: StackProfile[] = [
  nextProfile,
  astroProfile,
  expressProfile,
  djangoProfile,
  fastapiProfile,
  railsProfile,
  laravelProfile,
  goProfile,
  viteProfile,
];

/**
 * Cookie, CSRF, and auth-guard checks via stack profiles.
 * JWT / uploads / injection live in dedicated pattern modules.
 *
 * Sample apps and test fixtures are hidden from every profile first. A repo that vendors a
 * minimal Django app under `fixtures/` is not a Django app, and answering as if it were produces
 * advice for a framework the user does not run.
 */
export function runStackProfileChecks(ctx: SecurityScanProfileCtx, issues: IssueInput[]) {
  const scoped: SecurityScanProfileCtx = {
    ...ctx,
    files: ctx.files.filter((f) => !isNonShippingPath(f)),
    fileContents: shippingContents(ctx.fileContents),
  };
  const profile = pickStackProfile(PROFILES, scoped);
  checkCookiesWithProfile(profile, scoped, issues);
  checkCsrfWithProfile(profile, scoped, issues);
  checkAuthGuardsWithProfile(profile, scoped, issues);
  checkCorsWithProfile(profile, scoped, issues);
  checkHeadersWithProfile(profile, scoped, issues);
}
