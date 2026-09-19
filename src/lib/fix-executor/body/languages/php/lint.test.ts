import { describe, expect, it } from "vitest";

import { phpCsFixerConfigForProject } from "./lint";

describe("phpCsFixerConfigForProject", () => {
  it("targets Laravel app and test directories", () => {
    const config = phpCsFixerConfigForProject(["app/Models/User.php", "tests/TestCase.php"]);
    expect(config).toContain("->in(__DIR__ . '/app')");
    expect(config).toContain("->in(__DIR__ . '/tests')");
    expect(config).not.toContain("->in(__DIR__ . '/src')");
  });

  it("targets Symfony src and test directories without naming a missing app directory", () => {
    const config = phpCsFixerConfigForProject(["src/Kernel.php", "tests/bootstrap.php"]);
    expect(config).toContain("->in(__DIR__ . '/src')");
    expect(config).toContain("->in(__DIR__ . '/tests')");
    expect(config).not.toContain("->in(__DIR__ . '/app')");
  });

  it("falls back to the repository root for a flat PHP project", () => {
    const config = phpCsFixerConfigForProject(["index.php"]);
    expect(config).toContain("->in(__DIR__)");
    expect(config).toContain("->exclude(['vendor', 'var', 'cache', 'storage', 'public'])");
  });
});
