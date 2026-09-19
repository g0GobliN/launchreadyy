import { describe, expect, it } from "vitest";
import { eslintConfigForProject } from "./config";

describe("eslintConfigForProject", () => {
  it("creates a non-blocking baseline for an existing TypeScript repository", () => {
    const config = eslintConfigForProject(true);
    expect(config).toContain('"@typescript-eslint/no-unused-vars": ["warn"');
    expect(config).toContain('eqeqeq: ["warn"');
    expect(config).toContain('"types_db.ts"');
  });

  it("creates the same warning baseline for JavaScript", () => {
    const config = eslintConfigForProject(false);
    expect(config).toContain('"no-unused-vars": ["warn"');
    expect(config).toContain('eqeqeq: ["warn"');
  });
});
