//! Dependency-graph preprocessing: extract import specifiers and resolve local edges.
//!
//! Regex-based fast pass mirroring the TS `resolve.ts`/`build.ts` algorithms. Authoritative import
//! extraction stays in the TypeScript AST layer; this is the accelerator for large-repo edge builds.

use regex::Regex;
use serde::Serialize;
use std::collections::BTreeSet;
use std::sync::OnceLock;

const RESOLVE_EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs"];

fn import_regexes() -> &'static [Regex] {
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        vec![
            Regex::new(r#"\bfrom\s+['"]([^'"]+)['"]"#).unwrap(),
            Regex::new(r#"\bimport\s+['"]([^'"]+)['"]"#).unwrap(),
            Regex::new(r#"\brequire\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap(),
            Regex::new(r#"\bimport\(\s*['"]([^'"]+)['"]\s*\)"#).unwrap(),
        ]
    })
}

/// Extract module specifiers by regex (sorted, deduped).
///
/// Text-only, so it cannot distinguish code from comments or string literals. Kept as the fallback
/// for languages [`crate::ast`] cannot parse and for sources that fail to parse.
pub fn extract_imports_regex(content: &str) -> Vec<String> {
    let mut set = BTreeSet::new();
    for re in import_regexes() {
        for cap in re.captures_iter(content) {
            if let Some(m) = cap.get(1) {
                set.insert(m.as_str().to_string());
            }
        }
    }
    set.into_iter().collect()
}

/// Extract the set of module specifiers imported by a source file (sorted, deduped).
///
/// Mirrors the TypeScript path in `src/lib/graph/index.ts` exactly, so the graph is identical
/// whichever backend runs:
/// - not a JS/TS source, or skipped (`.d.ts`, minified, test/spec) → no imports
/// - JS/TS that parses → the AST result
/// - JS/TS that fails to parse → [`extract_imports_regex`]
pub fn extract_imports_for(path: &str, content: &str) -> Vec<String> {
    if !crate::ast::is_extractable(path) {
        return Vec::new();
    }
    crate::ast::extract_imports(path, content).unwrap_or_else(|| extract_imports_regex(content))
}

/// Regex-only extraction, for callers with no path to key the parser on.
///
/// Prefer [`extract_imports_for`] whenever the file path is known.
pub fn extract_imports(content: &str) -> Vec<String> {
    extract_imports_regex(content)
}

/// Normalize a POSIX-style path, collapsing `.` and `..` segments.
pub fn normalize_path(path: &str) -> String {
    let is_abs = path.starts_with('/');
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if out.last().is_some_and(|s| *s != "..") {
                    out.pop();
                } else if !is_abs {
                    out.push("..");
                }
            }
            s => out.push(s),
        }
    }
    let joined = out.join("/");
    if is_abs {
        format!("/{joined}")
    } else {
        joined
    }
}

fn dirname(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    }
}

/// Resolve a relative specifier against the repo file set, or `None` for external/unresolvable.
pub fn resolve_import(
    from_path: &str,
    specifier: &str,
    file_set: &BTreeSet<String>,
) -> Option<String> {
    if !specifier.starts_with('.') {
        return None;
    }
    let base = normalize_path(&format!("{}/{}", dirname(from_path), specifier));
    if file_set.contains(&base) {
        return Some(base);
    }
    for ext in RESOLVE_EXTS {
        let cand = format!("{base}.{ext}");
        if file_set.contains(&cand) {
            return Some(cand);
        }
    }
    for ext in RESOLVE_EXTS {
        let cand = format!("{base}/index.{ext}");
        if file_set.contains(&cand) {
            return Some(cand);
        }
    }
    None
}

/// The package name of a bare specifier: `@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`.
pub fn package_of(specifier: &str) -> String {
    if specifier.starts_with('@') {
        let parts: Vec<&str> = specifier.splitn(3, '/').collect();
        return parts.iter().take(2).copied().collect::<Vec<_>>().join("/");
    }
    specifier.split('/').next().unwrap_or(specifier).to_string()
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Edge {
    pub from: String,
    pub to: String,
}

pub struct FileImports {
    pub path: String,
    pub imports: Vec<String>,
}

/// Build import edges: local imports resolve to file paths, bare specifiers to `npm:<pkg>` nodes.
pub fn build_edges(files: &[FileImports]) -> Vec<Edge> {
    let file_set: BTreeSet<String> = files.iter().map(|f| f.path.clone()).collect();
    let mut edges = Vec::new();
    for f in files {
        for spec in &f.imports {
            if let Some(local) = resolve_import(&f.path, spec, &file_set) {
                edges.push(Edge {
                    from: f.path.clone(),
                    to: local,
                });
            } else if !spec.starts_with('.') {
                edges.push(Edge {
                    from: f.path.clone(),
                    to: format!("npm:{}", package_of(spec)),
                });
            }
        }
    }
    edges
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_import_specifiers() {
        let content = "import { a } from './lib';\nconst b = require('pg');\nimport('./dyn');";
        assert_eq!(extract_imports(content), vec!["./dyn", "./lib", "pg"]);
    }

    #[test]
    fn ast_path_beats_regex_on_commented_out_imports() {
        let content = "// import ghost from './ghost';\nimport real from './real';";
        // Regex cannot tell a comment from code; the parser can.
        assert_eq!(extract_imports_regex(content), vec!["./ghost", "./real"]);
        assert_eq!(extract_imports_for("a.ts", content), vec!["./real"]);
    }

    #[test]
    fn yields_nothing_for_non_js_languages() {
        // The TS path gives non-JS files no imports (its regex branch is gated on a JS/TS language),
        // so the accelerator must not invent Go edges the TS graph would not have.
        let content = "package main\nimport \"fmt\"\n";
        assert!(extract_imports_for("main.go", content).is_empty());
    }

    #[test]
    fn yields_nothing_for_files_the_ts_side_skips() {
        let src = "import a from './a';";
        for path in [
            "src/thing.test.ts",
            "src/thing.spec.tsx",
            "src/types.d.ts",
            "public/app.min.js",
            "public/app.bundle.js",
        ] {
            assert!(
                extract_imports_for(path, src).is_empty(),
                "{path} should contribute no imports"
            );
        }
        // A normal source file next to them still does.
        assert_eq!(extract_imports_for("src/thing.ts", src), vec!["./a"]);
    }

    #[test]
    fn falls_back_to_regex_when_parsing_fails() {
        let content = "import ok from './ok';\nfunction broken( {";
        assert_eq!(extract_imports_for("a.ts", content), vec!["./ok"]);
    }

    #[test]
    fn normalizes_paths() {
        assert_eq!(normalize_path("src/api/../lib/x.ts"), "src/lib/x.ts");
        assert_eq!(normalize_path("./a/./b"), "a/b");
    }

    #[test]
    fn resolves_and_classifies() {
        let mut files = BTreeSet::new();
        files.insert("src/lib/util.ts".to_string());
        files.insert("src/lib/index.ts".to_string());
        assert_eq!(
            resolve_import("src/a.ts", "./lib/util", &files).as_deref(),
            Some("src/lib/util.ts")
        );
        assert_eq!(
            resolve_import("src/a.ts", "./lib", &files).as_deref(),
            Some("src/lib/index.ts")
        );
        assert_eq!(resolve_import("src/a.ts", "react", &files), None);
        assert_eq!(package_of("@scope/pkg/sub"), "@scope/pkg");
    }

    #[test]
    fn builds_edges() {
        let files = vec![
            FileImports {
                path: "src/a.ts".into(),
                imports: vec!["./b".into(), "react".into()],
            },
            FileImports {
                path: "src/b.ts".into(),
                imports: vec![],
            },
        ];
        let edges = build_edges(&files);
        assert!(edges.contains(&Edge {
            from: "src/a.ts".into(),
            to: "src/b.ts".into()
        }));
        assert!(edges.contains(&Edge {
            from: "src/a.ts".into(),
            to: "npm:react".into()
        }));
    }
}
