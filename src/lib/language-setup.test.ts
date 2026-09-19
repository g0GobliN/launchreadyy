import { describe, expect, it } from "vitest";
import { buildLanguageReadmeSections, detectRepoStack } from "./language-setup";

describe("detectRepoStack", () => {
  it("detects Django from manage.py", () => {
    const s = detectRepoStack(
      ["manage.py", "requirements.txt", "myproject/settings.py"],
      "Python",
      { requirements: "Django>=5\n" },
    );
    expect(s.pythonStack).toBe("django");
    expect(s.label).toBe("Django");
  });

  it("detects FastAPI from requirements", () => {
    const s = detectRepoStack(["main.py", "requirements.txt"], "Python", {
      requirements: "fastapi\nuvicorn\n",
    });
    expect(s.pythonStack).toBe("fastapi");
  });

  it("detects Laravel", () => {
    const s = detectRepoStack(["artisan", "composer.json"], "PHP", {
      composerJson: '{"require":{"laravel/framework":"^11"}}',
    });
    expect(s.phpStack).toBe("laravel");
  });

  it("detects Go", () => {
    expect(detectRepoStack(["go.mod", "main.go"], "Go").language).toBe("go");
  });
});

describe("buildLanguageReadmeSections", () => {
  it("FastAPI readme uses pip and pytest not npm", () => {
    const stack = detectRepoStack(["main.py", "requirements.txt"], "Python", {
      requirements: "fastapi\n",
    });
    const text = buildLanguageReadmeSections({
      fullName: "acme/api",
      repoName: "api",
      framework: "Python",
      stack,
      envVars: ["DATABASE_URL"],
      withEnvStep: true,
    }).join("\n");
    expect(text).toContain("pip install");
    expect(text).toContain("pytest");
    expect(text).not.toContain("npm install");
    expect(text).not.toContain("Node.js");
    expect(text).not.toMatch(/\*\*3\. \*\*/);
    expect(text).toContain("**3.**");
    expect(text).toContain("Configure environment");
  });

  it("Django readme uses manage.py", () => {
    const stack = detectRepoStack(["manage.py", "requirements.txt"], "Python", {
      requirements: "Django\n",
    });
    const text = buildLanguageReadmeSections({
      fullName: "acme/web",
      repoName: "web",
      framework: "Python",
      stack,
      envVars: [],
      withEnvStep: false,
    }).join("\n");
    expect(text).toContain("python manage.py runserver");
    expect(text).toContain("python manage.py test");
  });

  it("Laravel readme uses composer and artisan", () => {
    const stack = detectRepoStack(["artisan", "composer.json"], "PHP", {
      composerJson: '{"require":{"laravel/framework":"^11"}}',
    });
    const text = buildLanguageReadmeSections({
      fullName: "acme/app",
      repoName: "app",
      framework: "PHP",
      stack,
      envVars: [],
      withEnvStep: false,
    }).join("\n");
    expect(text).toContain("composer install");
    expect(text).toContain("php artisan serve");
    expect(text).not.toContain("npm");
  });

  it("Go readme uses go mod download", () => {
    const stack = detectRepoStack(["go.mod"], "Go");
    const text = buildLanguageReadmeSections({
      fullName: "acme/svc",
      repoName: "svc",
      framework: "Go",
      stack,
      envVars: [],
      withEnvStep: false,
    }).join("\n");
    expect(text).toContain("go mod download");
    expect(text).toContain("go test ./...");
  });
});
