/**
 * Framework detection must key off structure, not prose.
 *
 * Both bugs covered here were found on a real scan: a TanStack app was classified as Django and
 * handed Django middleware advice, because (a) profiles matched the bare word "django" anywhere
 * in the sampled source, and (b) the repo vendors minimal sample apps under `fixtures/`.
 */
import { describe, expect, it } from "vitest";
import { runStackProfileChecks } from "./index";
import { djangoProfile } from "./django";
import { fastapiProfile } from "./fastapi";
import { railsProfile } from "./rails";
import { laravelProfile } from "./laravel";
import { pickStackProfile, type SecurityScanProfileCtx } from "./types";
import type { IssueInput } from "../../../scanner-rules";

function ctxOf(partial: Partial<SecurityScanProfileCtx>): SecurityScanProfileCtx {
  return {
    files: Object.keys(partial.fileContents ?? {}),
    fileContents: {},
    deps: {},
    ...partial,
  };
}

const ALL = [djangoProfile, fastapiProfile, railsProfile, laravelProfile];

describe("framework detection ignores prose", () => {
  it("does not call a TypeScript repo Django because its source mentions Django", () => {
    const ctx = ctxOf({
      fileContents: {
        "src/scanner/security.ts": `
          // Detects flask-talisman / django SecurityMiddleware in Python projects.
          export const DJANGO_HINT = /django/i;
        `,
        "package.json": JSON.stringify({ dependencies: { "@tanstack/react-router": "1.0.0" } }),
      },
    });
    expect(pickStackProfile(ALL, ctx)).toBeNull();
  });

  it("does not call a repo FastAPI, Rails, or Laravel from a passing mention", () => {
    const ctx = ctxOf({
      fileContents: {
        "docs/comparison.md": "We benchmarked against fastapi, Rails.application and laravel.",
      },
    });
    expect(pickStackProfile(ALL, ctx)).toBeNull();
  });

  it("still detects a real Django project from its manifest", () => {
    const ctx = ctxOf({
      fileContents: { "requirements.txt": "Django==5.0.1\npsycopg2==2.9" },
    });
    expect(pickStackProfile(ALL, ctx)?.id).toBe("django");
  });

  it("still detects a real Django project from manage.py", () => {
    const ctx = ctxOf({ files: ["manage.py", "app/views.py"], fileContents: {} });
    expect(pickStackProfile(ALL, ctx)?.id).toBe("django");
  });

  it("still detects a real Rails project from its Gemfile", () => {
    const ctx = ctxOf({ fileContents: { Gemfile: "source 'https://rubygems.org'\ngem 'rails'" } });
    expect(pickStackProfile(ALL, ctx)?.id).toBe("rails");
  });

  it("still detects a real Laravel project from composer.json", () => {
    const ctx = ctxOf({
      fileContents: {
        "composer.json": JSON.stringify({ require: { "laravel/framework": "^11" } }),
      },
    });
    expect(pickStackProfile(ALL, ctx)?.id).toBe("laravel");
  });
});

describe("framework detection ignores vendored sample apps", () => {
  it("does not classify a Node repo by a Django app living under fixtures/", () => {
    const issues: IssueInput[] = [];
    runStackProfileChecks(
      ctxOf({
        files: [
          "fixtures/minimal/django/manage.py",
          "fixtures/minimal/django/settings.py",
          "src/server.ts",
        ],
        fileContents: {
          "fixtures/minimal/django/settings.py": "INSTALLED_APPS = ['django.contrib.admin']",
          "src/server.ts": "export const handler = () => new Response('ok');",
        },
        deps: { "@tanstack/react-start": "1.0.0" },
      }),
      issues,
    );

    expect(issues.map((i) => i.title).join(" ")).not.toMatch(/Django/i);
  });
});
