import { describe, it, expect } from "vitest";
import { pickArchProfile, buildArchResolveCtx } from "./arch-lang-profiles";

function profileFor(paths: string[]) {
  const p = pickArchProfile(paths);
  if (!p) throw new Error("no profile picked");
  return p;
}

describe("pickArchProfile", () => {
  it("picks node for a TS repo", () => {
    expect(profileFor(["src/a.ts", "src/b.tsx", "main.py"]).id).toBe("node");
  });
  it("picks python for a Python repo", () => {
    expect(profileFor(["app/main.py", "app/models.py", "setup.py"]).id).toBe("python");
  });
  it("picks go for a Go repo", () => {
    expect(profileFor(["main.go", "internal/api/server.go"]).id).toBe("go");
  });
  it("returns null when no source files exist", () => {
    expect(pickArchProfile(["README.md", "logo.png"])).toBeNull();
  });
});

describe("node profile import parsing", () => {
  const profile = profileFor(["src/a.ts"]);

  it("parses named-brace imports (the most common JS style)", () => {
    expect(profile.parseImports('import { createServerClient } from "@supabase/ssr";')).toContain(
      "@supabase/ssr",
    );
  });

  it("parses prettier-split multi-line imports", () => {
    expect(
      profile.parseImports('import {\n  A,\n  B,\n  C,\n} from "@radix-ui/react-slot";'),
    ).toContain("@radix-ui/react-slot");
  });

  it("parses dynamic imports (lazy-loaded packages are real usage)", () => {
    expect(profile.parseImports('const s = await import("@stripe/stripe-js");')).toContain(
      "@stripe/stripe-js",
    );
  });

  it("parses re-exports", () => {
    expect(profile.parseImports('export { Button } from "./button";')).toContain("./button");
  });

  it("does not leak matches across statements", () => {
    const specs = profile.parseImports('export { a };\nconst x = "not-an-import";');
    expect(specs).toEqual([]);
  });

  it("counts CSS @import as package usage", () => {
    expect(profile.isUsageSource!("src/styles.css")).toBe(true);
    expect(profile.parseImports('@import "tailwindcss";\n@import "tw-animate-css";')).toEqual([
      "tailwindcss",
      "tw-animate-css",
    ]);
  });
});

describe("python from-dot imports", () => {
  const paths = ["src/flask/app.py", "src/flask/typing.py", "src/flask/__init__.py"];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, {});

  it("resolves `from . import name` to the sibling module, not __init__.py", () => {
    const specs = profile.parseImports("from . import typing as ft\n");
    expect(specs).toEqual([".typing"]);
    expect(profile.resolve("src/flask/app.py", ".typing", ctx)).toEqual(["src/flask/typing.py"]);
  });

  it("ignores indented (function-local / TYPE_CHECKING) imports", () => {
    const specs = profile.parseImports(
      "if t.TYPE_CHECKING:\n    from .app import Flask\n\ndef f():\n    import requests\n",
    );
    expect(specs).toEqual([]);
  });
});

describe("go versioned module matching", () => {
  const paths = ["main.go"];
  const profile = profileFor(paths);

  it("matches deps whose module path has a version suffix", () => {
    const used = new Set(["github.com/pelletier/go-toml"]);
    expect(profile.manifest!.matches!("github.com/pelletier/go-toml/v2", used)).toBe(true);
  });

  it("still reports a genuinely unused dep", () => {
    const used = new Set(["github.com/gin-gonic/gin"]);
    expect(profile.manifest!.matches!("github.com/unrelated/pkg", used)).toBe(false);
  });
});

describe("python profile", () => {
  const paths = ["app/__init__.py", "app/models.py", "app/api/routes.py", "main.py"];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, {});

  it("parses from/import statements", () => {
    const imports = profile.parseImports(
      "import os\nimport requests, flask\nfrom app.models import User\nfrom . import api\n",
    );
    expect(imports).toContain("requests");
    expect(imports).toContain("flask");
    expect(imports).toContain("app.models");
  });

  it("resolves absolute module paths to files", () => {
    expect(profile.resolve("main.py", "app.models", ctx)).toEqual(["app/models.py"]);
  });

  it("resolves `from a.b import symbol` to the parent module", () => {
    expect(profile.resolve("main.py", "app.models.User", ctx)).toEqual(["app/models.py"]);
  });

  it("treats stdlib as internal and third-party as external", () => {
    expect(profile.externalName("os", ctx)).toBeNull();
    expect(profile.externalName("requests", ctx)).toBe("requests");
  });

  it("maps dep aliases when checking usage", () => {
    expect(profile.manifest!.usedForms("Pillow")).toContain("pil");
    expect(profile.manifest!.parseDeps("flask==2.0\n# comment\npytest\n")).toEqual(["flask"]);
  });
});

describe("go profile", () => {
  const paths = ["main.go", "internal/db/db.go", "internal/db/models.go"];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, { goMod: "module github.com/me/app\n\ngo 1.22\n" });

  it("reads the module path from go.mod", () => {
    expect(ctx.goModule).toBe("github.com/me/app");
  });

  it("resolves internal package imports to every file in the package dir", () => {
    const resolved = profile.resolve("main.go", "github.com/me/app/internal/db", ctx);
    expect(resolved.sort()).toEqual(["internal/db/db.go", "internal/db/models.go"]);
  });

  it("classifies stdlib as internal and domain imports as external", () => {
    expect(profile.externalName("net/http", ctx)).toBeNull();
    expect(profile.externalName("github.com/gin-gonic/gin", ctx)).toBe("github.com/gin-gonic/gin");
  });

  it("parses go.mod requires and skips indirect ones", () => {
    const deps = profile.manifest!.parseDeps(
      "module github.com/me/app\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/sys v0.1.0 // indirect\n)\n",
    );
    expect(deps).toContain("github.com/gin-gonic/gin");
    expect(deps).not.toContain("golang.org/x/sys");
  });
});

describe("java profile", () => {
  const paths = [
    "src/main/java/com/shop/App.java",
    "src/main/java/com/shop/service/OrderService.java",
  ];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, {});

  it("resolves fully-qualified imports to source files", () => {
    expect(
      profile.resolve("src/main/java/com/shop/App.java", "com.shop.service.OrderService", ctx),
    ).toEqual(["src/main/java/com/shop/service/OrderService.java"]);
  });

  it("treats java.* as internal and spring as external", () => {
    expect(profile.externalName("java.util.List", ctx)).toBeNull();
    expect(profile.externalName("org.springframework.web.bind.RestController", ctx)).toBe(
      "org.springframework",
    );
  });
});

describe("rust profile", () => {
  const paths = ["src/main.rs", "src/db.rs", "src/api/mod.rs", "src/api/routes.rs"];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, {});

  it("resolves mod declarations from the crate root", () => {
    expect(profile.resolve("src/main.rs", "mod:db", ctx)).toEqual(["src/db.rs"]);
    expect(profile.resolve("src/main.rs", "mod:api", ctx)).toEqual(["src/api/mod.rs"]);
  });

  it("resolves crate:: paths", () => {
    expect(profile.resolve("src/db.rs", "crate::api::routes", ctx)).toEqual(["src/api/routes.rs"]);
  });

  it("parses Cargo.toml [dependencies] only", () => {
    const deps = profile.manifest!.parseDeps(
      '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\ntokio = { version = "1" }\n\n[dev-dependencies]\ncriterion = "0.5"\n',
    );
    expect(deps.sort()).toEqual(["serde", "tokio"]);
  });
});

describe("dart profile", () => {
  const paths = ["lib/main.dart", "lib/src/util.dart"];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, {
    pubspec: "name: myapp\ndependencies:\n  http: ^1.0.0\n",
  });

  it("resolves self-package imports into lib/", () => {
    expect(profile.resolve("lib/main.dart", "package:myapp/src/util.dart", ctx)).toEqual([
      "lib/src/util.dart",
    ]);
  });

  it("treats other packages as external and dart: as stdlib", () => {
    expect(profile.externalName("package:http/http.dart", ctx)).toBe("http");
    expect(profile.externalName("dart:async", ctx)).toBeNull();
  });

  it("parses pubspec dependencies", () => {
    expect(
      profile.manifest!.parseDeps(
        "name: myapp\ndependencies:\n  http: ^1.0.0\n  flutter:\n    sdk: flutter\n\ndev_dependencies:\n  lints: ^3.0.0\n",
      ),
    ).toEqual(["http"]);
  });
});

describe("php profile", () => {
  const paths = ["app/Http/Kernel.php", "public/index.php"];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, {
    composerJson: JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }),
  });

  it("resolves PSR-4 namespaced imports", () => {
    expect(profile.resolve("public/index.php", "App\\Http\\Kernel", ctx)).toEqual([
      "app/Http/Kernel.php",
    ]);
  });

  it("marks non-PSR-4 roots as external", () => {
    expect(profile.externalName("Illuminate\\Support\\Facades\\Route", ctx)).toBe("Illuminate");
    expect(profile.externalName("App\\Models\\User", ctx)).toBeNull();
  });
});

describe("elixir profile", () => {
  const paths = ["lib/my_app/accounts.ex", "lib/my_app_web/router.ex", "mix.exs"];
  const profile = profileFor(paths);
  const ctx = buildArchResolveCtx(paths, {});

  it("resolves module names via underscore convention", () => {
    expect(profile.resolve("lib/my_app_web/router.ex", "MyApp.Accounts", ctx)).toEqual([
      "lib/my_app/accounts.ex",
    ]);
  });
});

describe("swift / csharp profiles (limited mode)", () => {
  it("swift never resolves file edges — size checks only", () => {
    const paths = ["Sources/App/main.swift", "Sources/App/Router.swift"];
    const profile = profileFor(paths);
    const ctx = buildArchResolveCtx(paths, {});
    expect(profile.id).toBe("swift");
    expect(profile.resolve("Sources/App/main.swift", "Vapor", ctx)).toEqual([]);
    expect(profile.externalName("Vapor", ctx)).toBe("Vapor");
    expect(profile.externalName("Foundation", ctx)).toBeNull();
  });

  it("csharp treats System as stdlib", () => {
    const paths = ["src/Program.cs"];
    const profile = profileFor(paths);
    const ctx = buildArchResolveCtx(paths, {});
    expect(profile.id).toBe("csharp");
    expect(profile.externalName("System.Linq", ctx)).toBeNull();
    expect(profile.externalName("Newtonsoft.Json.Linq", ctx)).toBe("Newtonsoft.Json");
  });
});
