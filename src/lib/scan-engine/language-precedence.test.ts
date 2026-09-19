import { describe, expect, it } from "vitest";
import { runScan } from "./scan-repository";
import type { FileProvider } from "./file-provider";

/**
 * A backend framework that ships a package.json purely for asset bundling must still be
 * scanned as its real language.
 *
 * laravel/laravel ships `vite` in devDependencies for the asset pipeline. `detectFramework`
 * only ever sees package.json, so it returned "Vite"; the non-JS branch then tested that
 * already-collapsed value and came out false. A real Laravel app was therefore reported as a
 * Vite project and offered ESLint/Vitest rather than phpcs/PHPUnit. Verified against the real
 * repo: framework went "Vite" → "PHP" once precedence keyed off the detected language.
 */
function provider(files: string[], contents: Record<string, string>): FileProvider {
  return {
    listFiles: async () => files,
    readFile: async (p: string) => contents[p] ?? null,
  };
}

const LARAVEL_PKG = JSON.stringify({
  private: true,
  devDependencies: { vite: "^5.0.0", axios: "^1.6.0" },
});

describe("language precedence over asset-pipeline JS", () => {
  it("scans a Laravel repo as PHP even though it ships vite", async () => {
    const result = await runScan(
      provider(
        [
          "composer.json",
          "artisan",
          "package.json",
          "vite.config.js",
          "app/Http/Kernel.php",
          "routes/web.php",
        ],
        {
          "package.json": LARAVEL_PKG,
          "composer.json": JSON.stringify({ require: { "laravel/framework": "^11.0" } }),
        },
      ),
    );
    expect(result.framework).toBe("PHP");
  });

  it("still reports a real JS app as its JS framework", async () => {
    const result = await runScan(
      provider(["package.json", "next.config.js", "app/page.tsx"], {
        "package.json": JSON.stringify({ dependencies: { next: "^15.0.0", react: "^19.0.0" } }),
      }),
    );
    expect(result.framework).toBe("Next.js");
  });

  it("keeps a pure Vite app on Vite when no backend manifest is present", async () => {
    const result = await runScan(
      provider(["package.json", "vite.config.ts", "src/main.tsx"], {
        "package.json": JSON.stringify({ devDependencies: { vite: "^5.0.0" } }),
      }),
    );
    expect(result.framework).toBe("Vite");
  });

  it("scans a Rails repo as Ruby even though it ships a JS asset package.json", async () => {
    const result = await runScan(
      provider(["Gemfile", "package.json", "config/routes.rb", "app/controllers/x.rb"], {
        "package.json": JSON.stringify({ devDependencies: { vite: "^5.0.0" } }),
        Gemfile: 'source "https://rubygems.org"\ngem "rails"\n',
      }),
    );
    expect(result.framework).toBe("Ruby");
  });
});
