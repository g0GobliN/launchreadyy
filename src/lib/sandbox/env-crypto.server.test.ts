import { afterEach, describe, expect, it } from "vitest";
import { decryptEnvValue, encryptEnvValue } from "./env-crypto.server";

describe("env-crypto", () => {
  const prev = process.env.ENV_VAR_ENCRYPTION_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.ENV_VAR_ENCRYPTION_SECRET;
    else process.env.ENV_VAR_ENCRYPTION_SECRET = prev;
  });

  it("round-trips a value", () => {
    process.env.ENV_VAR_ENCRYPTION_SECRET = "test-secret-for-env-vars";
    const sealed = encryptEnvValue("postgres://secret");
    expect(sealed.split(".")).toHaveLength(3);
    expect(decryptEnvValue(sealed)).toBe("postgres://secret");
  });

  it("returns null for tampered ciphertext", () => {
    process.env.ENV_VAR_ENCRYPTION_SECRET = "test-secret-for-env-vars";
    const sealed = encryptEnvValue("hello");
    const parts = sealed.split(".");
    parts[2] = parts[2]!.replace(/A/g, "B") + "xx";
    expect(decryptEnvValue(parts.join("."))).toBeNull();
  });
});
