import { describe, expect, it } from "vitest";
import {
  buildWorkspacePackages,
  ciMatrixPackages,
  detectCodeStructure,
  detectIntegrations,
  detectWorkspacePackages,
  pickSourcePathsForAnalysis,
  scanEnvContract,
} from "./project-intelligence.server";

describe("detectWorkspacePackages", () => {
  it("finds monorepo roots", () => {
    expect(
      detectWorkspacePackages([
        "package.json",
        "capture-ui/package.json",
        "admin-backend/package.json",
      ]),
    ).toEqual([".", "capture-ui", "admin-backend"]);
  });
});

describe("scanEnvContract", () => {
  it("classifies VITE as build and STRIPE as test", () => {
    const contract = scanEnvContract({
      "src/App.jsx": `const x = import.meta.env.VITE_API_URL`,
      "src/server.ts": `const k = process.env.STRIPE_SECRET_KEY`,
    });
    expect(contract.build).toContain("VITE_API_URL");
    expect(contract.test).toContain("STRIPE_SECRET_KEY");
  });

  // Confirmed against the real w3cj/express-api-starter-ts src/env.ts: a typed-env-schema file
  // validates the whole `process.env` object in one call, so no `process.env.NAME` property
  // access ever appears anywhere — the vars only exist as z.object() keys. Without this case,
  // env-example-ai saw zero detected vars for this repo and, verified via a real DeepSeek call,
  // fabricated 7 vars (JWT_SECRET, DATABASE_URL, REDIS_URL, rate-limit config, etc.) that don't
  // exist anywhere in the app, while missing nothing about the two real ones (NODE_ENV, PORT).
  it("finds vars declared via a zod schema's .parse(process.env) instead of property access", () => {
    const contract = scanEnvContract({
      "src/env.ts": `import { z } from "zod/v4";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);`,
    });
    expect(contract.all).toContain("NODE_ENV");
    expect(contract.all).toContain("PORT");
  });
});

describe("detectIntegrations", () => {
  it("finds stripe from code", () => {
    const g = detectIntegrations(
      {},
      { "api/webhook.ts": "stripe.webhooks.constructEvent(body, sig, secret)" },
    );
    expect(g.stripe).toBe(true);
    expect(g.signals).toContain("Stripe payments/webhooks");
  });
});

describe("ciMatrixPackages", () => {
  it("excludes empty root when subpackages exist", async () => {
    const pkgs = await buildWorkspacePackages(
      [".", "frontend"],
      ["package.json", "frontend/package.json", "frontend/vite.config.js"],
      async (path) => {
        if (path === "frontend/package.json") {
          return JSON.stringify({
            name: "frontend",
            scripts: { build: "vite build", lint: "eslint ." },
            devDependencies: { vite: "7" },
          });
        }
        if (path === "package.json") return JSON.stringify({ name: "root", private: true });
        return null;
      },
    );
    const matrix = ciMatrixPackages(pkgs);
    expect(matrix).toHaveLength(1);
    expect(matrix[0]!.dir).toBe("frontend");
    expect(matrix[0]!.kind).toBe("frontend");
  });
});

describe("pickSourcePathsForAnalysis", () => {
  it("prioritizes api and entry files", () => {
    const paths = pickSourcePathsForAnalysis(
      ["src/utils.js", "src/api/stripe.js", "src/main.jsx", "tests/foo.test.js"],
      3,
    );
    expect(paths[0]).toMatch(/api|main/);
  });
});

describe("detectCodeStructure", () => {
  it("finds routes and api paths", () => {
    const s = detectCodeStructure(["app/page.tsx", "app/api/webhook/route.ts", "src/main.tsx"]);
    expect(s.routePaths.length).toBeGreaterThan(0);
    expect(s.apiPaths.some((p) => p.includes("api"))).toBe(true);
  });
});
