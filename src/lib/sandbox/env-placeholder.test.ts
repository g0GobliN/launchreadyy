import { describe, expect, it } from "vitest";
import {
  mergeEnvVars,
  parseEnvExampleLiterals,
  redactableEnvValues,
  synthesizePlaceholder,
} from "./env-placeholder";

describe("synthesizePlaceholder", () => {
  it("returns a postgres-shaped URL for DATABASE_URL", () => {
    expect(synthesizePlaceholder("DATABASE_URL")).toBe(
      "postgres://placeholder:placeholder@127.0.0.1:5432/placeholder",
    );
  });

  it("returns a generic https URL for other *_URL / *_URI keys", () => {
    expect(synthesizePlaceholder("API_URL")).toBe("https://placeholder.example.invalid");
    expect(synthesizePlaceholder("REDIS_URI")).toBe("https://placeholder.example.invalid");
  });

  it("returns a deterministic secret for *_KEY / *_SECRET / *_TOKEN", () => {
    const a = synthesizePlaceholder("STRIPE_SECRET_KEY");
    const b = synthesizePlaceholder("STRIPE_SECRET_KEY");
    expect(a).toBe(b);
    expect(a).toMatch(/^lr_placeholder_/);
    expect(synthesizePlaceholder("GITHUB_TOKEN")).toMatch(/^lr_placeholder_/);
    expect(synthesizePlaceholder("OPENAI_API_KEY")).toMatch(/^lr_placeholder_/);
  });

  it("returns a placeholder email for *_EMAIL", () => {
    expect(synthesizePlaceholder("ADMIN_EMAIL")).toBe("placeholder@example.invalid");
  });

  it("returns false for ENABLE_* / *_ENABLED", () => {
    expect(synthesizePlaceholder("ENABLE_ANALYTICS")).toBe("false");
    expect(synthesizePlaceholder("FEATURE_ENABLED")).toBe("false");
  });

  it("falls back to a deterministic string for unknown shapes", () => {
    expect(synthesizePlaceholder("NODE_ENV")).toMatch(/^lr_placeholder_/);
  });
});

describe("parseEnvExampleLiterals", () => {
  it("parses non-empty KEY=value lines and skips blanks/comments", () => {
    const content = `
# comment
DATABASE_URL=postgres://local/db
EMPTY=
QUOTED="hello world"
SINGLE='x'
SKIP_ME
PORT=3000
`;
    expect(parseEnvExampleLiterals(content)).toEqual({
      DATABASE_URL: "postgres://local/db",
      QUOTED: "hello world",
      SINGLE: "x",
      PORT: "3000",
    });
  });

  it("skips secret-shaped example values (empty or placeholder-looking secrets)", () => {
    const content = `
API_KEY=
API_SECRET=changeme
STRIPE_TOKEN=your-token-here
SAFE_URL=https://example.com
`;
    expect(parseEnvExampleLiterals(content)).toEqual({
      SAFE_URL: "https://example.com",
    });
  });
});

describe("mergeEnvVars", () => {
  it("prefers user values over example literals and synthesis", () => {
    const { entries } = mergeEnvVars({
      keys: ["DATABASE_URL", "API_KEY", "PORT"],
      userValues: { DATABASE_URL: "postgres://real/db" },
      exampleValues: { PORT: "3000", API_KEY: "https://example.com" },
    });
    expect(entries).toEqual({
      DATABASE_URL: { value: "postgres://real/db", source: "user" },
      API_KEY: { value: expect.stringMatching(/^lr_placeholder_/), source: "synthesized" },
      PORT: { value: "3000", source: "example" },
    });
  });

  it("synthesizes every key when nothing is supplied", () => {
    const { entries } = mergeEnvVars({ keys: ["ENABLE_FOO", "ADMIN_EMAIL"] });
    expect(entries.ENABLE_FOO).toEqual({ value: "false", source: "synthesized" });
    expect(entries.ADMIN_EMAIL).toEqual({
      value: "placeholder@example.invalid",
      source: "synthesized",
    });
  });

  it("ignores blank user values so synthesis/example can fill in", () => {
    const { entries } = mergeEnvVars({
      keys: ["PORT"],
      userValues: { PORT: "  " },
      exampleValues: { PORT: "8080" },
    });
    expect(entries.PORT).toEqual({ value: "8080", source: "example" });
  });

  it("exposes valuesAsRecord for sandbox injection", () => {
    const { valuesAsRecord } = mergeEnvVars({
      keys: ["PORT"],
      exampleValues: { PORT: "3000" },
    });
    expect(valuesAsRecord()).toEqual({ PORT: "3000" });
  });
});

describe("redactableEnvValues", () => {
  /**
   * Regression: the sandbox scrubbed every merged env value from its logs. Most of those values
   * are not secrets — `.env.example` is committed to the repository, and `false` is a placeholder
   * this code synthesizes for ENABLE_* keys. Blanking them protected nothing and destroyed the
   * artifact users read when a build fails: a real
   * `Type 'true' is not assignable to type 'false'` came back as `type [REDACTED]`.
   */
  it("leaves synthesized config constants alone", () => {
    const { entries } = mergeEnvVars({ keys: ["ENABLE_ANALYTICS", "APP_URL", "ADMIN_EMAIL"] });
    const values = redactableEnvValues(entries);
    expect(values).not.toContain("false");
    expect(values).not.toContain("https://placeholder.example.invalid");
    expect(values).not.toContain("placeholder@example.invalid");
  });

  it("leaves ordinary config words from .env.example alone", () => {
    const { entries } = mergeEnvVars({
      keys: ["NODE_ENV", "PORT", "LOG_LEVEL"],
      exampleValues: { NODE_ENV: "production", PORT: "3000", LOG_LEVEL: "debug" },
    });
    expect(redactableEnvValues(entries)).toEqual([]);
  });

  it("redacts what the user actually supplied", () => {
    const { entries } = mergeEnvVars({
      keys: ["API_TOKEN"],
      userValues: { API_TOKEN: "sk_live_9xKQ2mNbVc5XzLpD3f7R" }, // gitleaks:allow
    });
    expect(redactableEnvValues(entries)).toContain("sk_live_9xKQ2mNbVc5XzLpD3f7R"); // gitleaks:allow
  });

  it("still masks the synthesized secret placeholder", () => {
    const { entries } = mergeEnvVars({ keys: ["STRIPE_SECRET_KEY"] });
    expect(redactableEnvValues(entries)[0]).toMatch(/^lr_placeholder_/);
  });

  /** A credential committed to .env.example is public already, but masking it costs nothing. */
  it("redacts a long example literal that could be a real credential", () => {
    const { entries } = mergeEnvVars({
      keys: ["DATABASE_URL"],
      exampleValues: { DATABASE_URL: "postgres://admin:hunter2hunter2@db.example.com/prod" },
    });
    expect(redactableEnvValues(entries)).toHaveLength(1);
  });

  it("never redacts a user value that is just a config word", () => {
    const { entries } = mergeEnvVars({
      keys: ["NODE_ENV"],
      userValues: { NODE_ENV: "production" },
    });
    expect(redactableEnvValues(entries)).toEqual([]);
  });
});
