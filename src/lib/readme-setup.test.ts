import { describe, expect, it } from "vitest";
import { buildReadmeSections, scriptCommand } from "./readme-setup";

describe("buildReadmeSections", () => {
  it("uses real clone URL and scripts table", () => {
    const sections = buildReadmeSections({
      fullName: "acme/widget",
      repoName: "widget",
      framework: "Next.js",
      packageManager: "npm",
      scripts: { dev: "next dev", build: "next build", start: "next start", test: "vitest" },
      nodeVersion: "20",
      envVars: ["DATABASE_URL", "NEXTAUTH_SECRET"],
      withEnvStep: true,
    });

    const text = sections.join("\n\n");
    expect(text).toContain("git clone https://github.com/acme/widget.git");
    expect(text).toContain("**Stack:** Next.js");
    expect(text).toContain("Node.js 20+");
    expect(text).toContain("`DATABASE_URL`");
    expect(text).toContain("| `dev` | `npm run dev` |");
    expect(text).toContain("## Production build");
  });

  it("omits env step when not bundling env-example", () => {
    const sections = buildReadmeSections({
      fullName: "acme/app",
      repoName: "app",
      framework: "unknown",
      packageManager: "pnpm",
      scripts: { dev: "vite" },
      nodeVersion: "18",
      envVars: [],
      withEnvStep: false,
    });

    const text = sections.join("\n\n");
    expect(text).not.toContain("cp .env.example .env");
    expect(text).toContain("pnpm install");
  });
});

describe("scriptCommand", () => {
  it("uses npm run for non-lifecycle scripts", () => {
    expect(scriptCommand("npm", "dev")).toBe("npm run dev");
    expect(scriptCommand("npm", "start")).toBe("npm start");
  });
});
