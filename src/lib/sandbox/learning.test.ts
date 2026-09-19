import { describe, expect, it } from "vitest";
import { buildPrimingPlan, detectRequiredEnvVars, detectRequiredServices } from "./learning";

describe("detectRequiredServices", () => {
  it("infers postgres and redis from connection-failure lines", () => {
    const log = [
      "npm run build",
      "Error: connect ECONNREFUSED 127.0.0.1:5432",
      "Error: Redis connection to 127.0.0.1:6379 failed - ECONNREFUSED",
      "Build finished",
    ].join("\n");
    const services = detectRequiredServices(log)
      .map((s) => s.service)
      .sort();
    expect(services).toEqual(["postgres", "redis"]);
  });

  it("does NOT infer a service from a mere mention without a failure", () => {
    const log = "Connected to postgres successfully on :5432";
    expect(detectRequiredServices(log)).toEqual([]);
  });

  it("captures the port and evidence line", () => {
    const [svc] = detectRequiredServices("MongoNetworkError: failed to connect to server :27017");
    expect(svc.service).toBe("mongodb");
    expect(svc.port).toBe(27017);
    expect(svc.evidence).toContain("27017");
  });
});

describe("detectRequiredEnvVars", () => {
  it("extracts env var names from varied 'missing env' phrasings", () => {
    const log = [
      "Error: Missing required environment variable: DATABASE_URL",
      "Environment variable STRIPE_SECRET_KEY is required",
      "process.env.JWT_SECRET is undefined",
      "Please define the SESSION_SECRET environment variable",
    ].join("\n");
    const names = detectRequiredEnvVars(log)
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(["DATABASE_URL", "JWT_SECRET", "SESSION_SECRET", "STRIPE_SECRET_KEY"]);
  });

  it("dedupes repeated names", () => {
    const log = "Missing env variable: API_KEY\nprocess.env.API_KEY is undefined";
    expect(detectRequiredEnvVars(log)).toHaveLength(1);
  });

  it("returns nothing for a clean log", () => {
    expect(detectRequiredEnvVars("All good. Tests passed.")).toEqual([]);
  });
});

describe("buildPrimingPlan", () => {
  it("unions newly-detected needs with previously-known facts (knowledge accumulates)", () => {
    const plan = buildPrimingPlan({
      services: [{ service: "redis", evidence: "x" }],
      envVars: [{ name: "JWT_SECRET", evidence: "x" }],
      knownServices: ["postgres"],
      knownEnvVarNames: ["DATABASE_URL"],
    });
    expect(plan.services).toEqual(["postgres", "redis"]);
    expect(plan.envVarNames).toEqual(["DATABASE_URL", "JWT_SECRET"]);
  });
});
