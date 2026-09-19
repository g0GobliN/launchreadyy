import { describe, expect, it } from "vitest";
import {
  collectDependencies,
  dedupeDependencies,
  parseCargoLock,
  parseComposerLock,
  parseGemfileLock,
  parseGoSum,
  parseMixLock,
  parseNugetLock,
  parsePackageLock,
  parsePnpmLock,
  parsePoetryLock,
  parseRequirementsTxt,
  parseYarnLock,
  type Dependency,
} from "./dependency-inventory";

/** Find one package by name, so assertions do not depend on parse order. */
function find(deps: Dependency[], name: string): Dependency | undefined {
  return deps.find((d) => d.name === name);
}

describe("npm lockfiles", () => {
  it("reads exact versions and transitive packages from package-lock v3", () => {
    const deps = parsePackageLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "my-app", version: "1.0.0" },
          "node_modules/lodash": { version: "4.17.21" },
          "node_modules/express": { version: "4.18.2" },
          "node_modules/express/node_modules/debug": { version: "2.6.9" },
          "node_modules/@scope/pkg": { version: "0.3.1" },
          "packages/web": { link: true },
        },
      }),
    );

    expect(find(deps, "lodash")?.version).toBe("4.17.21");
    expect(find(deps, "@scope/pkg")?.version).toBe("0.3.1");
    // The whole point of a lockfile: transitive dependencies, which package.json never lists.
    expect(find(deps, "debug")?.version).toBe("2.6.9");
    // The root project and workspace links are not downloads and have no advisories.
    expect(find(deps, "my-app")).toBeUndefined();
    expect(deps.every((d) => d.ecosystem === "npm")).toBe(true);
  });

  /**
   * npm records a conflicting transitive version by nesting the path. Splitting on the *first*
   * `node_modules/` names the parent instead of the package, so `express/node_modules/debug`
   * would have been queried as "express" at debug's version — a wrong answer, not a missing one.
   */
  it("names the nested package, not its parent", () => {
    const deps = parsePackageLock(
      JSON.stringify({
        packages: { "node_modules/a/node_modules/b": { version: "1.2.3" } },
      }),
    );
    expect(deps).toEqual([{ ecosystem: "npm", name: "b", version: "1.2.3" }]);
  });

  it("falls back to the v1 nested layout", () => {
    const deps = parsePackageLock(
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          lodash: { version: "4.17.20" },
          express: { version: "4.17.1", dependencies: { debug: { version: "2.6.9" } } },
        },
      }),
    );
    expect(find(deps, "lodash")?.version).toBe("4.17.20");
    expect(find(deps, "debug")?.version).toBe("2.6.9");
  });

  it("reads pnpm keys across lockfile versions", () => {
    const deps = parsePnpmLock(
      [
        "packages:",
        "  /lodash/4.17.21:",
        "    resolution: {integrity: sha512-xxx}",
        "  /axios@1.6.0:",
        "    resolution: {integrity: sha512-yyy}",
        "  '/@scope/pkg@2.0.1':",
        "    resolution: {integrity: sha512-zzz}",
        "  react@18.2.0:",
        "    resolution: {integrity: sha512-www}",
      ].join("\n"),
    );
    expect(find(deps, "lodash")?.version).toBe("4.17.21");
    expect(find(deps, "axios")?.version).toBe("1.6.0");
    expect(find(deps, "@scope/pkg")?.version).toBe("2.0.1");
    expect(find(deps, "react")?.version).toBe("18.2.0");
  });

  it("reads yarn.lock entries including multi-spec headers", () => {
    const deps = parseYarnLock(
      [
        "# yarn lockfile v1",
        "",
        "lodash@^4.17.0, lodash@^4.17.21:",
        '  version "4.17.21"',
        '  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"',
        "",
        '"@scope/pkg@^2.0.0":',
        '  version "2.0.1"',
      ].join("\n"),
    );
    expect(find(deps, "lodash")?.version).toBe("4.17.21");
    expect(find(deps, "@scope/pkg")?.version).toBe("2.0.1");
  });
});

describe("non-npm ecosystems", () => {
  it("reads Cargo.lock", () => {
    const deps = parseCargoLock(
      [
        "[[package]]",
        'name = "serde"',
        'version = "1.0.197"',
        'checksum = "abc"',
        "",
        "[[package]]",
        'name = "tokio"',
        'version = "1.36.0"',
      ].join("\n"),
    );
    expect(find(deps, "serde")).toEqual({
      ecosystem: "crates.io",
      name: "serde",
      version: "1.0.197",
    });
    expect(find(deps, "tokio")?.version).toBe("1.36.0");
  });

  /**
   * poetry.lock nests `[package.source]` inside a package block, and that table has its own
   * `name` key. Matching `name =` anywhere in the block let the source name overwrite the
   * package's, so the query went out for a URL rather than a package.
   */
  it("reads poetry.lock without letting a nested table rename the package", () => {
    const deps = parsePoetryLock(
      [
        "[[package]]",
        'name = "django"',
        'version = "4.2.11"',
        "",
        "[package.source]",
        'type = "url"',
        'name = "not-the-package"',
      ].join("\n"),
    );
    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual({ ecosystem: "PyPI", name: "django", version: "4.2.11" });
  });

  it("reads pinned requirements and ignores ranges", () => {
    const deps = parseRequirementsTxt(
      [
        "# comment",
        "django==4.2.11",
        "requests[security]==2.31.0",
        "flask>=2.0  # a range says nothing about what installed",
        "-r other.txt",
        "",
      ].join("\n"),
    );
    expect(find(deps, "django")?.version).toBe("4.2.11");
    expect(find(deps, "requests")?.version).toBe("2.31.0");
    expect(find(deps, "flask")).toBeUndefined();
  });

  it("reads Gemfile.lock specs and stops at the next heading", () => {
    const deps = parseGemfileLock(
      [
        "GEM",
        "  remote: https://rubygems.org/",
        "  specs:",
        "    rails (7.1.3)",
        "      actionpack (= 7.1.3)",
        "    nokogiri (1.16.2)",
        "",
        "PLATFORMS",
        "  ruby",
        "",
        "DEPENDENCIES",
        "  rails (~> 7.1)",
      ].join("\n"),
    );
    expect(find(deps, "rails")?.version).toBe("7.1.3");
    expect(find(deps, "nokogiri")?.version).toBe("1.16.2");
    expect(deps.every((d) => d.ecosystem === "RubyGems")).toBe(true);
    // The DEPENDENCIES section lists ranges, not resolutions — it must not be read as one.
    expect(deps).toHaveLength(2);
  });

  it("reads composer.lock including dev packages", () => {
    const deps = parseComposerLock(
      JSON.stringify({
        packages: [{ name: "laravel/framework", version: "10.48.2" }],
        "packages-dev": [{ name: "phpunit/phpunit", version: "10.5.11" }],
      }),
    );
    expect(find(deps, "laravel/framework")?.version).toBe("10.48.2");
    expect(find(deps, "phpunit/phpunit")?.version).toBe("10.5.11");
  });

  it("reads go.sum once per module, skipping the /go.mod hash line", () => {
    const deps = parseGoSum(
      [
        "github.com/gin-gonic/gin v1.9.1 h1:aaa=",
        "github.com/gin-gonic/gin v1.9.1/go.mod h1:bbb=",
        "golang.org/x/crypto v0.21.0 h1:ccc=",
      ].join("\n"),
    );
    expect(deps).toHaveLength(2);
    // The `v` prefix is Go's, not the version's — OSV expects it stripped.
    expect(find(deps, "github.com/gin-gonic/gin")?.version).toBe("1.9.1");
    expect(find(deps, "golang.org/x/crypto")?.version).toBe("0.21.0");
  });

  it("reads mix.lock hex entries", () => {
    const deps = parseMixLock(
      '%{\n  "phoenix": {:hex, :phoenix, "1.7.11", "abc", [:mix], [], "hexpm", "def"},\n}',
    );
    expect(deps).toEqual([{ ecosystem: "Hex", name: "phoenix", version: "1.7.11" }]);
  });

  it("reads NuGet packages.lock.json resolved versions", () => {
    const deps = parseNugetLock(
      JSON.stringify({
        version: 1,
        dependencies: { "net8.0": { "Newtonsoft.Json": { resolved: "13.0.3" } } },
      }),
    );
    expect(find(deps, "Newtonsoft.Json")?.version).toBe("13.0.3");
  });
});

describe("robustness", () => {
  it("returns nothing for malformed input instead of throwing", () => {
    expect(parsePackageLock("{ not json")).toEqual([]);
    expect(parseComposerLock("")).toEqual([]);
    expect(parseNugetLock("null")).toEqual([]);
    expect(parseCargoLock("")).toEqual([]);
  });

  it("drops local and workspace placeholders that OSV cannot answer for", () => {
    const deps = parsePackageLock(
      JSON.stringify({
        packages: {
          "node_modules/a": { version: "file:../a" },
          "node_modules/b": { version: "workspace:*" },
          "node_modules/c": { version: "1.0.0" },
        },
      }),
    );
    expect(deps).toEqual([{ ecosystem: "npm", name: "c", version: "1.0.0" }]);
  });

  it("collapses the same package/version seen in two lockfiles", () => {
    const deps = dedupeDependencies([
      { ecosystem: "npm", name: "lodash", version: "4.17.21" },
      { ecosystem: "npm", name: "lodash", version: "4.17.21" },
      { ecosystem: "npm", name: "lodash", version: "4.17.20" },
    ]);
    expect(deps).toHaveLength(2);
  });
});

describe("collectDependencies", () => {
  /**
   * A polyglot repo carries several lockfiles at once. Stopping at the first match would leave
   * whichever service lost the race entirely unscanned.
   */
  it("merges every ecosystem present in the tree", async () => {
    const files: Record<string, string> = {
      "package-lock.json": JSON.stringify({
        packages: { "node_modules/lodash": { version: "4.17.21" } },
      }),
      "api/go.sum": "github.com/gin-gonic/gin v1.9.1 h1:aaa=",
      "worker/Cargo.lock": '[[package]]\nname = "serde"\nversion = "1.0.197"',
    };
    const deps = await collectDependencies(
      async (p) => files[p] ?? null,
      Object.keys(files).concat("README.md"),
    );

    expect(deps.map((d) => d.ecosystem).sort()).toEqual(["Go", "crates.io", "npm"]);
  });

  it("survives a lockfile it cannot read", async () => {
    const deps = await collectDependencies(
      async (p) => {
        if (p === "package-lock.json") throw new Error("too large");
        return "github.com/x/y v1.0.0 h1:aaa=";
      },
      ["package-lock.json", "go.sum"],
    );

    expect(deps).toEqual([{ ecosystem: "Go", name: "github.com/x/y", version: "1.0.0" }]);
  });

  it("reads nothing when the repo has no lockfile", async () => {
    const deps = await collectDependencies(async () => "irrelevant", ["src/index.ts"]);
    expect(deps).toEqual([]);
  });
});
