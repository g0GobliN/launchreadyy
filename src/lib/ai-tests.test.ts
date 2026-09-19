import { describe, expect, it } from "vitest";
import { NOT_A_SOURCE_SAMPLE, resolveDartPackagePubspec } from "./ai-tests.server";

// Confirmed against the real davidfowl/TodoApi: 6 of xunit-ai's 12 sample slots were EF Core
// migration files (including huge machine-generated *.Designer.cs snapshots), crowding the
// actual endpoint code out of the model's context entirely — TodoApi.cs/UsersApi.cs sort after
// Migrations/ and never made the cut. The same repo's Todo.Api.Tests/ project (the standard
// .NET test naming convention) was also invisible to the `tests/` dir rule.
describe("NOT_A_SOURCE_SAMPLE", () => {
  it("excludes EF Core migrations and .NET test projects", () => {
    expect(NOT_A_SOURCE_SAMPLE.test("Todo.Api/Migrations/20221123071234_Initial.Designer.cs")).toBe(
      true,
    );
    expect(NOT_A_SOURCE_SAMPLE.test("Todo.Api.Tests/TodoApiTests.cs")).toBe(true);
  });

  it("keeps real app source from the same repo", () => {
    expect(NOT_A_SOURCE_SAMPLE.test("Todo.Api/Todos/TodoApi.cs")).toBe(false);
    expect(NOT_A_SOURCE_SAMPLE.test("Todo.Api/Program.cs")).toBe(false);
  });

  it("keeps non-.NET app source unaffected", () => {
    expect(NOT_A_SOURCE_SAMPLE.test("app/models/article.rb")).toBe(false);
    expect(NOT_A_SOURCE_SAMPLE.test("src/main/java/App.java")).toBe(false);
    expect(NOT_A_SOURCE_SAMPLE.test("app/api/users.py")).toBe(false);
  });
});

describe("resolveDartPackagePubspec", () => {
  // Path shapes taken from the real roughike/inKino tree: a multi-package repo
  // (core/ + mobile/ + web/) with NO root pubspec.yaml — the `package:` import name a
  // generated test file needs lives in the pubspec sibling to the sampled lib/.
  it("resolves the pubspec of the package the samples came from", () => {
    const tree = [
      "core/pubspec.yaml",
      "core/lib/inkino_core.dart",
      "core/lib/data/actor.dart",
      "mobile/pubspec.yaml",
      "mobile/lib/main.dart",
      "web/pubspec.yaml",
      "web/lib/main.dart",
    ];
    const samples = [
      "core/lib/inkino_core.dart",
      "core/lib/data/actor.dart",
      "mobile/lib/main.dart",
    ];
    expect(resolveDartPackagePubspec(samples, tree)).toBe("core/pubspec.yaml");
  });

  it("resolves the root pubspec for a single-package repo", () => {
    expect(resolveDartPackagePubspec(["lib/main.dart"], ["pubspec.yaml", "lib/main.dart"])).toBe(
      "pubspec.yaml",
    );
  });

  it("returns null when no pubspec exists anywhere", () => {
    expect(resolveDartPackagePubspec(["lib/main.dart"], ["lib/main.dart"])).toBeNull();
  });
});
