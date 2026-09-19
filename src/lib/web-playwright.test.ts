import { describe, expect, it } from "vitest";
import { hasBrowsableWebUi, resolveLanguageWebCommand } from "./web-playwright";
import { resolvePlaywrightTarget } from "./playwright-config";

describe("web-playwright", () => {
  it("detects Django templates as browsable web UI", () => {
    expect(
      hasBrowsableWebUi({
        language: "python",
        isNodeProject: false,
        isStaticSpa: false,
        usesReact: false,
        filePaths: ["manage.py", "app/templates/home.html"],
        resolvedFramework: "Django",
      }),
    ).toBe(true);
  });

  it("rejects native mobile frameworks", () => {
    expect(
      hasBrowsableWebUi({
        language: "dart",
        isNodeProject: false,
        isStaticSpa: false,
        usesReact: false,
        filePaths: ["lib/main.dart"],
        resolvedFramework: "Flutter",
      }),
    ).toBe(false);
  });

  it("accepts Electron and Expo as browser-automation targets", () => {
    expect(
      hasBrowsableWebUi({
        language: "node",
        isNodeProject: true,
        isStaticSpa: false,
        usesReact: true,
        filePaths: ["package.json"],
        resolvedFramework: "Electron",
      }),
    ).toBe(true);
    expect(
      hasBrowsableWebUi({
        language: "node",
        isNodeProject: true,
        isStaticSpa: false,
        usesReact: true,
        filePaths: ["package.json", "app.json"],
        resolvedFramework: "Expo",
      }),
    ).toBe(true);
  });

  it("resolves Django dev server command", () => {
    const cmd = resolveLanguageWebCommand({
      language: "python",
      filePaths: ["manage.py", "requirements.txt"],
      framework: "Django",
      manifests: { requirements: "django\n" },
    });
    expect(cmd.command).toContain("runserver");
    expect(cmd.port).toBe(8000);
  });

  it("builds playwright target for Rails without package.json", () => {
    const target = resolvePlaywrightTarget({
      language: "ruby",
      isNodeProject: false,
      framework: "Ruby on Rails",
      filePaths: ["Gemfile", "config/routes.rb", "app/views/home/index.html.erb"],
      manifests: { gemfile: "rails" },
    });
    expect(target.runCommand).toContain("rails server");
    expect(target.baseUrl).toBe("http://localhost:3000");
  });
});
