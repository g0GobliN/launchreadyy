import { describe, expect, it } from "vitest";
import {
  buildPlaywrightConfig,
  isCompositeDevScript,
  parsePortFromText,
  pickPlaywrightConfigPaths,
  resolveDevScript,
  resolvePlaywrightTarget,
  resolveWebServerScript,
  playwrightTestDevDepVersion,
} from "./playwright-config";

describe("playwright-config", () => {
  it("parses custom vite port", () => {
    expect(
      resolvePlaywrightTarget({
        framework: "Vite",
        scripts: { dev: "vite" },
        configFiles: { "vite.config.ts": "export default { server: { port: 5174 } }" },
      }).port,
    ).toBe(5174);
  });

  it("uses dev:vite when dev script is missing", () => {
    expect(
      resolveDevScript({
        "dev:vite": "vite dev",
      }),
    ).toBe("dev:vite");
  });

  it("uses primary dev script even when concurrently wraps sidecars", () => {
    expect(
      resolveDevScript({
        dev: "concurrently npm:dev:vite npm:dev:stripe",
        "dev:vite": "vite dev",
      }),
    ).toBe("dev");
  });

  it("reads port from package script flags", () => {
    expect(
      resolvePlaywrightTarget({
        scripts: { dev: "next dev --port 4001" },
        framework: "Next.js",
      }).port,
    ).toBe(4001);
  });

  it("picks monorepo web app vite config first", () => {
    const paths = pickPlaywrightConfigPaths([
      "vite.config.ts",
      "apps/web/vite.config.ts",
      "packages/ui/vite.config.ts",
    ]);
    expect(paths[0]).toBe("apps/web/vite.config.ts");
  });

  it("emits webServer with pm-aware run command", () => {
    const config = buildPlaywrightConfig({
      packageManager: "pnpm",
      framework: "Vite",
      scripts: { "dev:vite": "vite dev" },
      configFiles: { "vite.config.ts": "port: 5174" },
    });
    expect(config).toContain('command: "pnpm dev:vite"');
    expect(config).toContain("http://localhost:5174");
    expect(config).toContain("webServer");
  });

  it("detects composite dev scripts", () => {
    expect(isCompositeDevScript("concurrently a b")).toBe(true);
    expect(isCompositeDevScript("vite dev")).toBe(false);
  });

  it("uses dev:vite for webServer when dev bundles stripe", () => {
    const scripts = {
      "dev:vite": "vite dev",
      "dev:stripe": "stripe listen --forward-to localhost:5174/api/stripe/webhook",
      dev: "concurrently --kill-others-on-fail npm:dev:vite npm:dev:stripe",
    };
    expect(resolveDevScript(scripts)).toBe("dev");
    expect(resolveWebServerScript(scripts)).toBe("dev:vite");
    const target = resolvePlaywrightTarget({
      packageManager: "npm",
      framework: "Vite",
      scripts,
      configFiles: { "vite.config.ts": "port: 5174" },
    });
    expect(target.runCommand).toBe("npm run dev:vite");
    expect(target.port).toBe(5174);
    expect(playwrightTestDevDepVersion({ playwright: "^1.61.1" })).toBe("^1.61.1");
  });
});
