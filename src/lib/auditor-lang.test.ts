import { describe, expect, it } from "vitest";
import {
  auditorLanguageFromFramework,
  extractEnvVars,
  hasStripeDependency,
  isBackendApiRepo,
} from "./auditor-lang.server";

describe("auditor-lang", () => {
  it("maps framework labels to auditor language", () => {
    expect(auditorLanguageFromFramework("Python")).toBe("python");
    expect(auditorLanguageFromFramework("Java")).toBe("java");
    expect(auditorLanguageFromFramework("Vite")).toBe("node");
  });

  it("extracts Python env vars", () => {
    const vars = extractEnvVars(
      'x = os.getenv("DATABASE_URL")\ny = os.environ["API_KEY"]',
      "python",
    );
    expect([...vars].sort()).toEqual(["API_KEY", "DATABASE_URL"]);
  });

  it("detects stripe in Java manifests", () => {
    expect(
      hasStripeDependency({}, { pomXml: "<dependency><groupId>com.stripe</groupId></dependency>" }),
    ).toBe(true);
  });

  it("detects Python API backends", () => {
    expect(isBackendApiRepo("python", ["main.py"], { pyprojectToml: "fastapi = '*'" })).toBe(true);
  });

  it("detects Go API backends", () => {
    expect(isBackendApiRepo("go", ["cmd/server/main.go"], {})).toBe(true);
  });
});
