import { describe, expect, it } from "vitest";
import { extractKnowledgeFacts } from "./extract-facts";
import { buildRepoKnowledgeContext, type KnowledgeFactRow } from "./context";
import { KNOWLEDGE_FACT_KEYS as K } from "./fact-keys";

describe("extractKnowledgeFacts", () => {
  it("derives facts from a typical Next.js + Postgres project", () => {
    const facts = extractKnowledgeFacts({
      framework: "Next.js",
      language: "TypeScript",
      files: ["package-lock.json", ".github/workflows/ci.yml", "vercel.json", "Dockerfile"],
      deps: { next: "14", vitest: "2", eslint: "9", prettier: "3", pg: "8", "@prisma/client": "5" },
      scripts: { build: "next build", test: "vitest run" },
      engines: { node: ">=20" },
      dockerfile: "FROM node:20-alpine\nWORKDIR /app\n",
    });
    const byKey = Object.fromEntries(facts.map((f) => [f.factKey, f]));

    expect(byKey[K.framework].value).toBe("Next.js");
    expect(byKey[K.packageManager].value).toBe("npm");
    expect(byKey[K.ciProvider].value).toBe("github-actions");
    expect(byKey[K.deploymentTarget].value).toBe("vercel");
    expect(byKey[K.nodeVersion].value).toBe(">=20");
    expect(byKey[K.buildCommand].value).toBe("next build");
    expect(byKey[K.testFramework].value).toBe("vitest");
    expect(byKey[K.dockerImage].value).toBe("node:20-alpine");
    expect(byKey[K.database].value).toBe("postgres");
    expect(byKey[K.orm].value).toBe("prisma");
  });

  it("emits no fact when there is no evidence (never guesses)", () => {
    const facts = extractKnowledgeFacts({
      framework: "unknown",
      language: "unknown",
      files: [],
      deps: {},
      scripts: {},
    });
    expect(facts).toHaveLength(0);
  });

  it("tiers manifest-declared facts (2) above dependency-inferred ones (3)", () => {
    const facts = extractKnowledgeFacts({
      framework: "Express",
      language: "JavaScript",
      files: ["yarn.lock"],
      deps: { express: "4", mongoose: "8" },
      scripts: {},
    });
    const pm = facts.find((f) => f.factKey === K.packageManager)!;
    const db = facts.find((f) => f.factKey === K.database)!;
    expect(pm.tier).toBe(2);
    expect(pm.value).toBe("yarn");
    expect(db.tier).toBe(3);
    expect(db.value).toBe("mongodb");
  });

  it("prefers pnpm/bun lockfiles over package-lock", () => {
    const facts = extractKnowledgeFacts({
      framework: "Vite",
      language: "TypeScript",
      files: ["pnpm-lock.yaml", "package-lock.json"],
      deps: {},
      scripts: {},
    });
    expect(facts.find((f) => f.factKey === K.packageManager)!.value).toBe("pnpm");
  });
});

describe("buildRepoKnowledgeContext", () => {
  const facts: KnowledgeFactRow[] = [
    { fact_key: "framework", value: "Next.js", confidence: "high", state: "verified" },
    { fact_key: "database", value: "postgres", confidence: "low", state: "hypothesis" },
    { fact_key: "package-manager", value: "pnpm", confidence: "medium", state: "hypothesis" },
    { fact_key: "orm", value: "prisma", confidence: "low", state: "disputed" },
  ];

  it("renders verified and hypothesis facts, marking verified and low-confidence", () => {
    const ctx = buildRepoKnowledgeContext(facts);
    expect(ctx).toContain("Framework: Next.js (verified)");
    expect(ctx).toContain("Database: postgres (low confidence)");
    expect(ctx).toContain("Package manager: pnpm");
  });

  it("excludes disputed/stale facts", () => {
    const ctx = buildRepoKnowledgeContext(facts);
    expect(ctx).not.toContain("prisma"); // disputed
  });

  it("returns empty string when there are no usable facts", () => {
    expect(buildRepoKnowledgeContext([])).toBe("");
    expect(
      buildRepoKnowledgeContext([
        { fact_key: "orm", value: "x", confidence: "low", state: "stale" },
      ]),
    ).toBe("");
  });

  it("orders by confidence (high first)", () => {
    const ctx = buildRepoKnowledgeContext(facts);
    const fw = ctx.indexOf("Framework");
    const pm = ctx.indexOf("Package manager");
    const db = ctx.indexOf("Database");
    expect(fw).toBeLessThan(pm); // high before medium
    expect(pm).toBeLessThan(db); // medium before low
  });
});
