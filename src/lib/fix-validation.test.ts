import { describe, expect, it } from "vitest";
import { validateGeneratedFile } from "./fix-validation";

describe("validateGeneratedFile", () => {
  it("accepts valid TypeScript", () => {
    const result = validateGeneratedFile(
      "tests/unit.test.ts",
      `import { describe, it, expect } from "vitest";\ndescribe("x", () => { it("y", () => { expect(1).toBe(1); }); });\n`,
    );
    expect(result.status).toBe("valid");
  });

  it("rejects TypeScript with a syntax error", () => {
    const result = validateGeneratedFile(
      "tests/unit.test.ts",
      `import { describe, it, expect } from "vitest";\ndescribe("x", () => { it("y", () => { expect(1).toBe(1); }\n`,
    );
    expect(result.status).toBe("invalid");
  });

  it("accepts valid TSX", () => {
    const result = validateGeneratedFile(
      "src/Widget.tsx",
      `export function Widget() { return <div>hi</div>; }\n`,
    );
    expect(result.status).toBe("valid");
  });

  it("rejects a leftover markdown code fence", () => {
    const result = validateGeneratedFile(
      "tests/unit.test.ts",
      '```ts\nimport { describe } from "vitest";\n```\n',
    );
    expect(result.status).toBe("invalid");
  });

  it("accepts valid YAML", () => {
    const result = validateGeneratedFile(
      ".github/workflows/ci.yml",
      `name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`,
    );
    expect(result.status).toBe("valid");
  });

  it("rejects malformed YAML", () => {
    const result = validateGeneratedFile(
      ".github/workflows/ci.yml",
      `name: CI\non: [push\njobs: {build: `,
    );
    expect(result.status).toBe("invalid");
  });

  it("accepts valid JSON", () => {
    const result = validateGeneratedFile("package.json", `{"name": "app", "version": "1.0.0"}`);
    expect(result.status).toBe("valid");
  });

  it("rejects malformed JSON", () => {
    const result = validateGeneratedFile("package.json", `{"name": "app",}`);
    expect(result.status).toBe("invalid");
  });

  it("accepts a valid .env.example", () => {
    const result = validateGeneratedFile(
      ".env.example",
      `# comment\nDATABASE_URL=postgres://localhost\nAPI_KEY=\n`,
    );
    expect(result.status).toBe("valid");
  });

  it("rejects a malformed .env.example line", () => {
    const result = validateGeneratedFile(
      ".env.example",
      `DATABASE_URL=postgres://localhost\nthis is not a valid line\n`,
    );
    expect(result.status).toBe("invalid");
  });

  it("marks unsupported languages as unverified rather than faking a check", () => {
    const result = validateGeneratedFile("tests/test_app.py", `def test_x():\n    assert 1 == 1\n`);
    expect(result.status).toBe("unverified");
  });

  it("does not flag a README's own legitimate code fences as malformed output", () => {
    // Regression: an earlier version ran the stray-fence heuristic on every file type,
    // which flagged every well-formed README (any install/setup instructions use fences)
    // as "invalid" even though the content was correct.
    const result = validateGeneratedFile(
      "README.md",
      `# App\n\n## Install\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Run\n\n\`\`\`bash\nnpm run dev\n\`\`\`\n`,
    );
    expect(result.status).toBe("valid");
  });

  it("rejects a README with a duplicate section heading", () => {
    // Found via live testing against a real repo: told to "merge into one" when a Getting
    // Started section already exists, the model instead appended a second, near-duplicate
    // section on top of the original rather than merging.
    const result = validateGeneratedFile(
      "README.md",
      `# App\n\n## Getting Started\n\n### Setup\n\nRun npm install.\n\n## Local Development\n\n### Setup\n\nRun npm install and npm run dev.\n`,
    );
    expect(result.status).toBe("invalid");
    expect(result.detail).toMatch(/duplicate section heading/i);
  });

  it("rejects a README with two identical code blocks", () => {
    const block = "git clone https://github.com/example/app\ncd app\nnpm install\nnpm run dev";
    const result = validateGeneratedFile(
      "README.md",
      `# App\n\n## Getting Started\n\n\`\`\`bash\n${block}\n\`\`\`\n\n## Local Development\n\n\`\`\`bash\n${block}\n\`\`\`\n`,
    );
    expect(result.status).toBe("invalid");
    expect(result.detail).toMatch(/identical code blocks/i);
  });

  it("accepts a README where sections legitimately differ", () => {
    const result = validateGeneratedFile(
      "README.md",
      `# App\n\n## Getting Started\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n## Deployment\n\nDeploy via your hosting provider of choice.\n`,
    );
    expect(result.status).toBe("valid");
  });

  it("rejects empty content regardless of extension", () => {
    expect(validateGeneratedFile("README.md", "   \n  ").status).toBe("invalid");
  });
});
