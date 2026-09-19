/**
 * Per-language knowledge for the architecture scanner: how to read imports out of a source
 * file, how to map an import back to a file in the repo, what counts as an external package,
 * and where the dependency manifest lives.
 *
 * Resolution is deliberately conservative — an unresolvable import simply produces no graph
 * edge, and the scanner's entry-point rule ("any file nothing imports is an entry") means
 * missing edges can only hide findings, never invent them. Languages whose imports don't map
 * to files at all (Swift modules, C# namespaces) still get size/duplication checks; their
 * resolve() just always returns [].
 */

export interface ArchResolveCtx {
  allPaths: Set<string>;
  /** module path from go.mod — needed to tell internal Go imports from external ones */
  goModule?: string;
  /** package name from pubspec.yaml — resolves `package:self/...` Dart imports */
  dartPackage?: string;
  /** PSR-4 prefix → directory map from composer.json */
  psr4?: Record<string, string>;
}

export interface ArchLangProfile {
  id: string;
  /** matches source files this profile analyses */
  isSource(path: string): boolean;
  /** raw import specifiers found in one file */
  parseImports(content: string): string[];
  /** repo files a specifier points at ([] = unresolvable/external) */
  resolve(fromFile: string, spec: string, ctx: ArchResolveCtx): string[];
  /** external package name for a specifier, or null if internal/stdlib */
  externalName(spec: string, ctx: ArchResolveCtx): string | null;
  /** entry-point file names (exact path or basename suffix match) */
  entryNames: string[];
  /** manifest for the unused-dependency check; omit to skip that check */
  manifest?: {
    path: string;
    parseDeps(content: string): string[];
    /** normalized dep name candidates that would count as "used" */
    usedForms(dep: string): string[];
    /** custom dep↔usage matcher — overrides the exact usedForms check when present */
    matches?(dep: string, used: Set<string>): boolean;
  };
  /**
   * Wider file filter for the unused-dependency check only. Go needs this: a dep imported
   * solely in _test.go files (testify) is still a real dependency, but tests are excluded
   * from the structure graph.
   */
  isUsageSource?(path: string): boolean;
  /**
   * false where import cycles are legal/idiomatic (Rust modules, Elixir) or impossible
   * (the Go compiler rejects them — any "cycle" we see is a resolution artifact).
   */
  cyclesMatter?: boolean;
  /**
   * false for namespace-import languages (Java, Kotlin, C#, Swift) where every file in a
   * framework app shares the same coarse import set — the fingerprint heuristic only
   * produces noise there.
   */
  duplicateLogicMatters?: boolean;
}

const dirname = (p: string) => (p.includes("/") ? p.split("/").slice(0, -1).join("/") : "");

const norm = (s: string) => s.toLowerCase().replace(/-/g, "_");

function joinNorm(base: string, rel: string): string {
  const parts = (base ? base.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

// ─── Node / JS / TS ───────────────────────────────────────────────────────────

const JS_EXTS = ["ts", "tsx", "js", "jsx"];

const nodeProfile: ArchLangProfile = {
  id: "node",
  isSource: (p) =>
    /\.(ts|tsx|js|jsx|mts|mjs)$/.test(p) && !p.endsWith(".d.ts") && !p.includes("node_modules"),
  // CSS files count for the unused-dep check: `@import "tailwindcss"` is real usage of a
  // package that never appears in a JS import. The import regex matches @import lines too.
  isUsageSource: (p) =>
    /\.(ts|tsx|js|jsx|mts|mjs|css)$/.test(p) && !p.endsWith(".d.ts") && !p.includes("node_modules"),
  parseImports(content) {
    const out: string[] = [];
    // Covers: static imports (incl. `{ named }` and prettier-split multi-line forms),
    // side-effect imports, re-exports (`export ... from`), dynamic `import("x")`, and
    // `require("x")`. Dynamic imports matter — lazy-loaded packages (Stripe, AI SDKs) are
    // real usage and must not be flagged as unused. The middle part excludes quotes and
    // semicolons (bounded length) so a match can never leak across statements.
    const re =
      /(?:import\s+(?:type\s+)?(?:[^'";]{0,500}?from\s+)?|export\s+(?:type\s+)?[^'";]{0,500}?from\s+|import\s*\(\s*|require\s*\()\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
  },
  resolve(fromFile, spec, ctx) {
    if (!spec.startsWith(".")) return [];
    const base = joinNorm(dirname(fromFile), spec);
    const tries = [
      base,
      ...JS_EXTS.map((e) => `${base}.${e}`),
      ...JS_EXTS.map((e) => `${base}/index.${e}`),
    ];
    const hit = tries.find((t) => ctx.allPaths.has(t));
    return hit ? [hit] : [];
  },
  externalName(spec) {
    if (spec.startsWith(".") || spec.startsWith("node:")) return null;
    return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  },
  entryNames: [
    "src/main.ts",
    "src/main.tsx",
    "src/index.ts",
    "src/index.tsx",
    "index.ts",
    "index.js",
    "server.ts",
    "server.js",
    "app.ts",
    "app.js",
  ],
  manifest: {
    path: "package.json",
    parseDeps(content) {
      try {
        const pkg = JSON.parse(content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        // Build/CLI tools and CSS-imported packages never show up as JS imports
        const IMPLICIT = new Set([
          "typescript",
          "prettier",
          "eslint",
          "@types/node",
          "tailwindcss",
          "tw-animate-css",
          "autoprefixer",
          "postcss",
          "wrangler",
          "concurrently",
          "husky",
          "lint-staged",
          "nodemon",
          "tsx",
          "ts-node",
        ]);
        return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
          (d) => !IMPLICIT.has(d) && !d.startsWith("@types/"),
        );
      } catch {
        return [];
      }
    },
    usedForms: (dep) => [dep],
  },
};

// ─── Python ───────────────────────────────────────────────────────────────────

const PY_STDLIB = new Set(
  (
    "os sys re json typing datetime pathlib collections itertools functools math logging " +
    "asyncio subprocess unittest dataclasses abc enum io time random string uuid hashlib " +
    "base64 urllib http contextlib copy pickle tempfile shutil glob argparse threading " +
    "multiprocessing socket struct textwrap traceback warnings weakref inspect importlib " +
    "secrets statistics decimal queue signal sqlite3 csv configparser zoneinfo ast operator " +
    "types codecs xml html email zipfile tarfile gzip zlib platform getpass stat fnmatch " +
    "tokenize keyword builtins gc atexit select selectors ssl ipaddress binascii mimetypes " +
    "wsgiref concurrent ctypes venv pdb timeit doctest pkgutil runpy __future__"
  ).split(" "),
);

const PY_DEP_ALIASES: Record<string, string[]> = {
  pillow: ["pil"],
  scikit_learn: ["sklearn"],
  beautifulsoup4: ["bs4"],
  pyyaml: ["yaml"],
  python_dotenv: ["dotenv"],
  psycopg2_binary: ["psycopg2"],
  opencv_python: ["cv2"],
  pyjwt: ["jwt"],
  djangorestframework: ["rest_framework"],
};

const PY_TOOL_DEPS = new Set(
  (
    "gunicorn uwsgi pytest black flake8 mypy ruff isort tox coverage pre_commit setuptools " +
    "wheel pip twine build pytest_cov pytest_asyncio pytest_django pip_tools"
  ).split(" "),
);

const pythonProfile: ArchLangProfile = {
  id: "python",
  isSource: (p) => p.endsWith(".py"),
  parseImports(content) {
    // Top-level (column-0) imports only. Indented imports — inside functions or under
    // `if TYPE_CHECKING:` — are the standard Python idioms for deliberately breaking import
    // cycles, so counting them as static edges manufactures false circular-dep findings.
    const out: string[] = [];
    const re = /^(?:from\s+([.\w]+)\s+import\s+([^\n]+)|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) {
        if (/^\.+$/.test(m[1])) {
          // `from . import typing, json` imports sibling MODULES — resolving the bare dots
          // to __init__.py would fabricate edges into the package root (and fake cycles,
          // since __init__.py re-exports everything). Point each name at its own module.
          const names = m[2].replace(/[()\\]/g, "");
          for (const part of names.split(",")) {
            const name = part.trim().split(/\s+as\s+/)[0];
            if (/^\w+$/.test(name)) out.push(m[1] + name);
          }
        } else {
          out.push(m[1]);
        }
      } else if (m[3]) {
        for (const part of m[3].split(",")) out.push(part.trim().split(/\s+as\s+/)[0]);
      }
    }
    return out.filter(Boolean);
  },
  resolve(fromFile, spec, ctx) {
    const tryPaths = (base: string): string[] => {
      const tries = [`${base}.py`, `${base}/__init__.py`];
      const hit = tries.find((t) => ctx.allPaths.has(t));
      return hit ? [hit] : [];
    };
    if (spec.startsWith(".")) {
      const dots = spec.match(/^\.+/)![0].length;
      let base = dirname(fromFile);
      for (let i = 1; i < dots; i++) base = dirname(base);
      const rest = spec.slice(dots);
      // parseImports always attaches a module name after the dots, so rest is never empty
      if (!rest) return [];
      return tryPaths(joinNorm(base, rest.replace(/\./g, "/")));
    }
    const rel = spec.replace(/\./g, "/");
    for (const root of ["", "src/"]) {
      const full = tryPaths(root + rel);
      if (full.length) return full;
      // `from a.b import c` where c is a symbol, not a module — resolve a/b instead
      const parent = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : "";
      if (parent) {
        const p = tryPaths(root + parent);
        if (p.length) return p;
      }
    }
    return [];
  },
  externalName(spec) {
    if (spec.startsWith(".")) return null;
    const root = spec.split(".")[0];
    return PY_STDLIB.has(root) ? null : root;
  },
  entryNames: ["main.py", "app.py", "manage.py", "wsgi.py", "asgi.py", "src/main.py"],
  manifest: {
    path: "requirements.txt",
    parseDeps(content) {
      return content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
        .map((l) => l.split(/[=<>!~[;\s]/)[0])
        .filter((d) => d && !PY_TOOL_DEPS.has(norm(d)));
    },
    usedForms(dep) {
      const n = norm(dep);
      return [n, ...(PY_DEP_ALIASES[n] ?? [])];
    },
  },
};

// ─── Go ───────────────────────────────────────────────────────────────────────

const goProfile: ArchLangProfile = {
  id: "go",
  isSource: (p) => p.endsWith(".go") && !p.endsWith("_test.go") && !p.includes("vendor/"),
  parseImports(content) {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    const single = /^import\s+(?:\w+\s+)?"([^"]+)"/gm;
    while ((m = single.exec(content)) !== null) out.push(m[1]);
    const block = /import\s*\(([^)]*)\)/g;
    while ((m = block.exec(content)) !== null) {
      let inner: RegExpExecArray | null;
      const q = /"([^"]+)"/g;
      while ((inner = q.exec(m[1])) !== null) out.push(inner[1]);
    }
    return out;
  },
  resolve(_fromFile, spec, ctx) {
    if (!ctx.goModule) return [];
    if (spec !== ctx.goModule && !spec.startsWith(ctx.goModule + "/")) return [];
    const dir = spec === ctx.goModule ? "" : spec.slice(ctx.goModule.length + 1);
    const prefix = dir ? `${dir}/` : "";
    return [...ctx.allPaths].filter(
      (p) => p.startsWith(prefix) && p.endsWith(".go") && !p.slice(prefix.length).includes("/"),
    );
  },
  externalName(spec, ctx) {
    if (ctx.goModule && (spec === ctx.goModule || spec.startsWith(ctx.goModule + "/"))) return null;
    if (!spec.split("/")[0].includes(".")) return null; // stdlib (fmt, net/http)
    return spec.split("/").slice(0, 3).join("/");
  },
  entryNames: ["main.go", "cmd/main.go"],
  cyclesMatter: false,
  isUsageSource: (p) => p.endsWith(".go") && !p.includes("vendor/"),
  manifest: {
    path: "go.mod",
    parseDeps(content) {
      const deps: string[] = [];
      const re = /^\s*([\w./-]+)\s+v[\w.+-]+(\s*\/\/\s*indirect)?/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!m[2] && m[1] !== "module" && m[1] !== "go") deps.push(m[1]);
      }
      return deps;
    },
    usedForms: (dep) => [dep],
    // Import specs get sliced to 3 path segments, but module paths can have more
    // ("github.com/pelletier/go-toml/v2") — match by prefix in either direction.
    matches(dep, used) {
      return [...used].some((u) => u === dep || u.startsWith(`${dep}/`) || dep.startsWith(`${u}/`));
    },
  },
};

// ─── Java / Kotlin ────────────────────────────────────────────────────────────

function jvmProfile(id: string, ext: string): ArchLangProfile {
  return {
    id,
    isSource: (p) => p.endsWith(ext) && !p.includes("/build/") && !p.includes("/target/"),
    parseImports(content) {
      const out: string[] = [];
      const re = /^import\s+(?:static\s+)?([\w.]+?)(\.\*)?\s*;?\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!m[2]) out.push(m[1]);
      }
      return out;
    },
    resolve(_fromFile, spec, ctx) {
      const segs = spec.split(".");
      // try full path, then parent (static import of a member)
      for (const cut of [segs, segs.slice(0, -1)]) {
        if (cut.length === 0) continue;
        const suffix = "/" + cut.join("/") + ext;
        const hit = [...ctx.allPaths].find((p) => p.endsWith(suffix));
        if (hit) return [hit];
      }
      return [];
    },
    externalName(spec) {
      const root = spec.split(".").slice(0, 2).join(".");
      return root.startsWith("java.") || root.startsWith("javax.") || root.startsWith("kotlin.")
        ? null
        : root;
    },
    entryNames: [],
    duplicateLogicMatters: false,
  };
}

// ─── Rust ─────────────────────────────────────────────────────────────────────

const rustProfile: ArchLangProfile = {
  id: "rust",
  isSource: (p) => p.endsWith(".rs") && !p.includes("target/"),
  parseImports(content) {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    const use = /^\s*(?:pub\s+)?use\s+([\w:]+)/gm;
    while ((m = use.exec(content)) !== null) out.push(m[1]);
    const mod = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
    while ((m = mod.exec(content)) !== null) out.push(`mod:${m[1]}`);
    return out;
  },
  resolve(fromFile, spec, ctx) {
    const tryPaths = (cands: string[]): string[] => {
      const hit = cands.find((c) => ctx.allPaths.has(c));
      return hit ? [hit] : [];
    };
    const dir = dirname(fromFile);
    const stem = fromFile.split("/").pop()!.replace(/\.rs$/, "");
    const isRoot = ["main", "lib", "mod"].includes(stem);
    if (spec.startsWith("mod:")) {
      const name = spec.slice(4);
      const base = isRoot ? dir : `${dir}/${stem}`;
      return tryPaths(
        [`${base}/${name}.rs`, `${base}/${name}/mod.rs`].map((p) => p.replace(/^\//, "")),
      );
    }
    const segs = spec.split("::");
    if (segs[0] === "crate") {
      const rest = segs.slice(1);
      const cands: string[] = [];
      for (let n = rest.length; n >= 1; n--) {
        const path = rest.slice(0, n).join("/");
        cands.push(`src/${path}.rs`, `src/${path}/mod.rs`);
      }
      return tryPaths(cands);
    }
    if (segs[0] === "super" || segs[0] === "self") {
      const base = segs[0] === "super" ? dirname(dir) : dir;
      const rest = segs.slice(1);
      if (rest.length === 0) return [];
      const path = rest.join("/");
      return tryPaths(
        [`${base}/${path}.rs`, `${base}/${path}/mod.rs`].map((p) => p.replace(/^\//, "")),
      );
    }
    return [];
  },
  externalName(spec) {
    if (spec.startsWith("mod:")) return null;
    const root = spec.split("::")[0];
    return ["crate", "super", "self", "std", "core", "alloc"].includes(root) ? null : norm(root);
  },
  entryNames: ["src/main.rs", "src/lib.rs"],
  cyclesMatter: false,
  manifest: {
    path: "Cargo.toml",
    parseDeps(content) {
      const section = content.split(/^\[dependencies\]/m)[1];
      if (!section) return [];
      const body = section.split(/^\[/m)[0];
      const deps: string[] = [];
      const re = /^([\w-]+)\s*=/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) deps.push(m[1]);
      return deps;
    },
    usedForms: (dep) => [norm(dep)],
  },
};

// ─── Ruby ─────────────────────────────────────────────────────────────────────

const rubyProfile: ArchLangProfile = {
  id: "ruby",
  isSource: (p) => p.endsWith(".rb") && !p.includes("vendor/"),
  parseImports(content) {
    const out: string[] = [];
    const re = /^\s*require(_relative)?\s+['"]([^'"]+)['"]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.push((m[1] ? "rel:" : "") + m[2]);
    return out;
  },
  resolve(fromFile, spec, ctx) {
    if (spec.startsWith("rel:")) {
      const target = joinNorm(dirname(fromFile), spec.slice(4)) + ".rb";
      return ctx.allPaths.has(target) ? [target] : [];
    }
    const cands = [`lib/${spec}.rb`, `${spec}.rb`];
    const hit = cands.find((c) => ctx.allPaths.has(c));
    return hit ? [hit] : [];
  },
  externalName(spec) {
    if (spec.startsWith("rel:")) return null;
    return spec.split("/")[0];
  },
  entryNames: ["config.ru", "app.rb", "main.rb", "Rakefile"],
};

// ─── PHP ──────────────────────────────────────────────────────────────────────

const phpProfile: ArchLangProfile = {
  id: "php",
  isSource: (p) => p.endsWith(".php") && !p.includes("vendor/"),
  parseImports(content) {
    const out: string[] = [];
    const re = /^use\s+([\w\\]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
  },
  resolve(_fromFile, spec, ctx) {
    if (!ctx.psr4) return [];
    for (const [prefix, dir] of Object.entries(ctx.psr4)) {
      if (!spec.startsWith(prefix)) continue;
      const rel = spec.slice(prefix.length).replace(/\\/g, "/");
      const target = `${dir.replace(/\/$/, "")}/${rel}.php`;
      if (ctx.allPaths.has(target)) return [target];
    }
    return [];
  },
  externalName(spec, ctx) {
    if (ctx.psr4 && Object.keys(ctx.psr4).some((prefix) => spec.startsWith(prefix))) return null;
    return spec.split("\\")[0];
  },
  entryNames: ["public/index.php", "index.php", "artisan"],
};

// ─── Elixir ───────────────────────────────────────────────────────────────────

function elixirUnderscore(seg: string): string {
  return seg
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

const elixirProfile: ArchLangProfile = {
  id: "elixir",
  isSource: (p) => (p.endsWith(".ex") || p.endsWith(".exs")) && !p.includes("deps/"),
  parseImports(content) {
    const out: string[] = [];
    const re = /^\s*(?:alias|import|use|require)\s+([\w.]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
  },
  resolve(_fromFile, spec, ctx) {
    const rel = spec.split(".").map(elixirUnderscore).join("/");
    const cands = [`lib/${rel}.ex`, `lib/${rel}/${rel.split("/").pop()}.ex`];
    const hit = cands.find((c) => ctx.allPaths.has(c));
    return hit ? [hit] : [];
  },
  externalName(spec) {
    const root = spec.split(".")[0];
    return [
      "Kernel",
      "Enum",
      "Map",
      "List",
      "String",
      "Task",
      "Agent",
      "GenServer",
      "Supervisor",
    ].includes(root)
      ? null
      : root;
  },
  entryNames: ["mix.exs"],
  cyclesMatter: false,
};

// ─── Dart ─────────────────────────────────────────────────────────────────────

const dartProfile: ArchLangProfile = {
  id: "dart",
  isSource: (p) => p.endsWith(".dart") && !p.includes(".dart_tool/"),
  parseImports(content) {
    const out: string[] = [];
    const re = /^import\s+['"]([^'"]+)['"]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
  },
  resolve(fromFile, spec, ctx) {
    if (spec.startsWith("dart:")) return [];
    if (spec.startsWith("package:")) {
      const [pkg, ...rest] = spec.slice(8).split("/");
      if (pkg !== ctx.dartPackage) return [];
      const target = `lib/${rest.join("/")}`;
      return ctx.allPaths.has(target) ? [target] : [];
    }
    const target = joinNorm(dirname(fromFile), spec);
    return ctx.allPaths.has(target) ? [target] : [];
  },
  externalName(spec, ctx) {
    if (!spec.startsWith("package:")) return null;
    const pkg = spec.slice(8).split("/")[0];
    return pkg === ctx.dartPackage || pkg === "flutter" ? null : pkg;
  },
  entryNames: ["lib/main.dart", "bin/main.dart"],
  manifest: {
    path: "pubspec.yaml",
    parseDeps(content) {
      const section = content.split(/^dependencies:\s*$/m)[1];
      if (!section) return [];
      const deps: string[] = [];
      for (const line of section.split("\n")) {
        if (/^\S/.test(line)) break; // next top-level key
        const m = line.match(/^ {2}([\w-]+):/);
        if (m && m[1] !== "flutter") deps.push(m[1]);
      }
      return deps;
    },
    usedForms: (dep) => [dep],
  },
};

// ─── Swift / C# (no file-level import graph — size & duplication checks only) ─

const swiftProfile: ArchLangProfile = {
  id: "swift",
  isSource: (p) => p.endsWith(".swift"),
  parseImports(content) {
    const out: string[] = [];
    const re = /^import\s+(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
  },
  resolve: () => [],
  externalName(spec) {
    return ["Foundation", "UIKit", "SwiftUI", "Combine", "XCTest"].includes(spec) ? null : spec;
  },
  entryNames: [],
  duplicateLogicMatters: false,
};

const csharpProfile: ArchLangProfile = {
  id: "csharp",
  isSource: (p) => p.endsWith(".cs") && !p.includes("/obj/") && !p.includes("/bin/"),
  parseImports(content) {
    const out: string[] = [];
    const re = /^\s*using\s+([\w.]+)\s*;/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.push(m[1]);
    return out;
  },
  resolve: () => [],
  externalName(spec) {
    const root = spec.split(".")[0];
    return root === "System" ? null : spec.split(".").slice(0, 2).join(".");
  },
  entryNames: ["Program.cs"],
  duplicateLogicMatters: false,
};

// ─── Profile selection ────────────────────────────────────────────────────────

const ALL_PROFILES: ArchLangProfile[] = [
  nodeProfile,
  pythonProfile,
  goProfile,
  jvmProfile("java", ".java"),
  jvmProfile("kotlin", ".kt"),
  rustProfile,
  rubyProfile,
  phpProfile,
  elixirProfile,
  dartProfile,
  swiftProfile,
  csharpProfile,
];

/** Picks the profile with the most matching source files in the repo. */
export function pickArchProfile(allPaths: string[]): ArchLangProfile | null {
  let best: ArchLangProfile | null = null;
  let bestCount = 0;
  for (const profile of ALL_PROFILES) {
    const count = allPaths.reduce((n, p) => n + (profile.isSource(p) ? 1 : 0), 0);
    if (count > bestCount) {
      best = profile;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

/** Builds the resolver context from manifest file contents (pass null when absent). */
export function buildArchResolveCtx(
  allPaths: string[],
  manifests: { goMod?: string | null; pubspec?: string | null; composerJson?: string | null },
): ArchResolveCtx {
  const ctx: ArchResolveCtx = { allPaths: new Set(allPaths) };
  const modLine = manifests.goMod?.match(/^module\s+(\S+)/m);
  if (modLine) ctx.goModule = modLine[1];
  const nameLine = manifests.pubspec?.match(/^name:\s*(\S+)/m);
  if (nameLine) ctx.dartPackage = nameLine[1];
  if (manifests.composerJson) {
    try {
      const composer = JSON.parse(manifests.composerJson) as {
        autoload?: { "psr-4"?: Record<string, string | string[]> };
      };
      const psr4 = composer.autoload?.["psr-4"];
      if (psr4) {
        ctx.psr4 = {};
        for (const [prefix, dir] of Object.entries(psr4)) {
          ctx.psr4[prefix] = Array.isArray(dir) ? dir[0] : dir;
        }
      }
    } catch {
      // malformed composer.json — PHP imports just won't resolve internally
    }
  }
  return ctx;
}
