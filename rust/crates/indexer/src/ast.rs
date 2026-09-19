//! AST-backed import extraction for JS/TS sources.
//!
//! Replaces the regex pass in [`crate::graph`] for files a real parser can read. Regex cannot tell
//! code from text, so it reports specifiers that are only mentioned in a comment or a string literal
//! and misses forms that span lines. Parsing removes that whole class of error.
//!
//! Static ESM specifiers come from oxc's `ModuleRecord::requested_modules` — the spec's
//! `[[RequestedModules]]`, which already covers `import`, bare `import "x"`, `export … from` and
//! `export *`. CommonJS `require()`, dynamic `import()` and TypeScript's `import x = require()` are
//! not ESM module requests, so a visitor collects those.
//!
//! Pure Rust (no C deps) so the crate still builds for `wasm32-unknown-unknown`.

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportExpression, NewExpression,
    TSImportEqualsDeclaration, TSModuleReference,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::Serialize;
use std::collections::BTreeSet;

/// Mirrors `UNSAFE_CALLEES` in `src/lib/scanner/ast/rules/unsafe-calls.ts`.
const UNSAFE_CALLEES: &[(&str, &str)] = &[
    ("eval", "eval()"),
    ("exec", "child_process exec/spawn"),
    ("execSync", "child_process exec/spawn"),
    ("spawn", "child_process exec/spawn"),
    ("spawnSync", "child_process exec/spawn"),
    ("execFile", "child_process exec/spawn"),
    ("execFileSync", "child_process exec/spawn"),
];

/// One AST-confirmed unsafe call site — the TS `UnsafeCallHit` shape.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct UnsafeCallHit {
    pub label: String,
    pub callee: String,
    pub line: u32,
}

fn last_segment(name: &str) -> &str {
    let trimmed = name.trim();
    trimmed.rsplit('.').next().unwrap_or(trimmed)
}

fn line_at(content: &str, byte_offset: u32) -> u32 {
    let end = (byte_offset as usize).min(content.len());
    content[..end].bytes().filter(|&b| b == b'\n').count() as u32 + 1
}

fn span_text(content: &str, span: oxc_span::Span) -> String {
    content
        .get(span.start as usize..span.end as usize)
        .unwrap_or("")
        .to_string()
}

fn label_for_callee(callee: &str) -> Option<&'static str> {
    let last = last_segment(callee);
    UNSAFE_CALLEES
        .iter()
        .find(|(name, _)| *name == last)
        .map(|(_, label)| *label)
}

/// Collects unsafe `eval` / `child_process` calls and `new Function(...)`.
struct UnsafeCollector<'a> {
    content: &'a str,
    hits: Vec<UnsafeCallHit>,
}

impl<'a> Visit<'a> for UnsafeCollector<'a> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let callee = span_text(self.content, call.callee.span());
        if let Some(label) = label_for_callee(&callee) {
            self.hits.push(UnsafeCallHit {
                label: label.to_string(),
                callee,
                line: line_at(self.content, call.span.start),
            });
        }
        oxc_ast_visit::walk::walk_call_expression(self, call);
    }

    fn visit_new_expression(&mut self, expr: &NewExpression<'a>) {
        let callee = span_text(self.content, expr.callee.span());
        if last_segment(&callee) == "Function" {
            self.hits.push(UnsafeCallHit {
                label: "new Function()".into(),
                callee,
                line: line_at(self.content, expr.span.start),
            });
        }
        oxc_ast_visit::walk::walk_new_expression(self, expr);
    }
}

/// Collects the non-ESM specifiers: `require("x")`, `import("x")`, `import x = require("x")`.
#[derive(Default)]
struct SpecifierCollector {
    found: Vec<String>,
}

/// The specifier of a call's first argument, when it is a plain string literal.
fn first_string_arg(call: &CallExpression<'_>) -> Option<String> {
    match call.arguments.first()? {
        Argument::StringLiteral(lit) => Some(lit.value.to_string()),
        _ => None,
    }
}

impl<'a> Visit<'a> for SpecifierCollector {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        // Bare `require(...)` only. A member call like `foo.require("x")` is not a module request,
        // which is precisely what the regex pass got wrong.
        if let Expression::Identifier(ident) = &call.callee {
            if ident.name == "require" {
                if let Some(spec) = first_string_arg(call) {
                    self.found.push(spec);
                }
            }
        }
        oxc_ast_visit::walk::walk_call_expression(self, call);
    }

    fn visit_import_expression(&mut self, expr: &ImportExpression<'a>) {
        if let Expression::StringLiteral(lit) = &expr.source {
            self.found.push(lit.value.to_string());
        }
        oxc_ast_visit::walk::walk_import_expression(self, expr);
    }

    fn visit_ts_import_equals_declaration(&mut self, decl: &TSImportEqualsDeclaration<'a>) {
        if let TSModuleReference::ExternalModuleReference(ext) = &decl.module_reference {
            self.found.push(ext.expression.value.to_string());
        }
        oxc_ast_visit::walk::walk_ts_import_equals_declaration(self, decl);
    }
}

/// True when a path is a JS/TS source oxc can parse.
pub fn is_parseable(path: &str) -> bool {
    matches!(
        path.rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs"
    )
}

/// Files the TypeScript side deliberately refuses to parse, mirroring the `SKIP` pattern in
/// `src/lib/scanner/ast/language.ts`: declarations, minified/bundled output, and tests/specs.
fn is_skipped(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);

    if name.ends_with(".d.ts") {
        return true;
    }
    // `.min.js` / `.bundle.jsx` / `.min.cjs` …
    let js_ext = ["js", "jsx", "cjs", "mjs", "cjsx", "mjsx"];
    let jt_ext = ["js", "jsx", "cjs", "mjs", "ts", "tsx", "cts", "mts"];
    for (markers, exts) in [
        (["min", "bundle"].as_slice(), js_ext.as_slice()),
        (["test", "spec"].as_slice(), jt_ext.as_slice()),
    ] {
        for marker in markers {
            for ext in exts {
                if name.ends_with(&format!(".{marker}.{ext}")) {
                    return true;
                }
            }
        }
    }
    false
}

/// Whether this file should contribute imports at all.
///
/// The TypeScript path yields no imports for non-JS languages and for skipped files (its
/// `detectAstLanguage` returns null, and the regex branch is gated on the language being JS/TS). The
/// accelerator has to agree, or turning `flag_rust_indexer` on would change the graph — which is the
/// one thing a drop-in must never do.
pub fn is_extractable(path: &str) -> bool {
    is_parseable(path) && !is_skipped(path)
}

/// Module specifiers imported by a JS/TS source, sorted and deduped.
///
/// Returns `None` when the file is not a JS/TS source or the parser could not produce a usable
/// tree, so callers can fall back to the regex pass rather than silently reporting no imports.
pub fn extract_imports(path: &str, content: &str) -> Option<Vec<String>> {
    if !is_parseable(path) {
        return None;
    }

    // `.d.ts` and JSX-vs-type-assertion ambiguity both hinge on the extension, so derive the source
    // type from the path and only fall back to a permissive default if that fails.
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::tsx());
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, source_type).parse();

    // oxc raises `panicked` for any syntax error, mild ones included, and empties `program` when it
    // does. `module_record` survives, but without a program the visitor below cannot see `require()`
    // or dynamic `import()`, so trusting the record alone would under-report imports. Under-reporting
    // hides real dependency edges, whereas the regex fallback only ever over-reports — so hand a
    // broken file back to the caller instead.
    if ret.panicked {
        return None;
    }

    let mut set: BTreeSet<String> = ret
        .module_record
        .requested_modules
        .keys()
        .map(|s| s.to_string())
        .collect();

    let mut collector = SpecifierCollector::default();
    collector.visit_program(&ret.program);
    set.extend(collector.found);

    Some(set.into_iter().collect())
}

/// Unsafe dynamic-execution call sites for a JS/TS source.
///
/// Returns `None` when the file is not extractable or the parser panics — the TypeScript
/// `findUnsafeCalls` path (or the regex rule) must handle those. `Some(vec)` means the file was
/// parsed: empty means clean, non-empty means real call sites (comments/strings ignored).
pub fn find_unsafe_calls(path: &str, content: &str) -> Option<Vec<UnsafeCallHit>> {
    if !is_extractable(path) {
        return None;
    }

    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::tsx());
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, source_type).parse();
    if ret.panicked {
        return None;
    }

    let mut collector = UnsafeCollector {
        content,
        hits: Vec::new(),
    };
    collector.visit_program(&ret.program);
    collector
        .hits
        .sort_by(|a, b| a.line.cmp(&b.line).then(a.callee.cmp(&b.callee)));
    Some(collector.hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn imports(src: &str) -> Vec<String> {
        extract_imports("a.ts", src).expect("parses")
    }

    #[test]
    fn collects_every_static_form() {
        let src = r#"
            import a from "./a";
            import "./bare";
            import { b } from "./b";
            import * as c from "./c";
            export { d } from "./d";
            export * from "./e";
            export * as f from "./f";
        "#;
        assert_eq!(
            imports(src),
            vec!["./a", "./b", "./bare", "./c", "./d", "./e", "./f"]
        );
    }

    #[test]
    fn collects_require_and_dynamic_import() {
        let src = r#"
            const a = require("pg");
            const b = await import("./lazy");
            import c = require("legacy");
        "#;
        assert_eq!(imports(src), vec!["./lazy", "legacy", "pg"]);
    }

    #[test]
    fn ignores_specifiers_inside_comments_and_strings() {
        // The regex pass reports all four of these. None is a real import.
        let src = r#"
            // import x from "./commented-out";
            /* require("./block-comment") */
            const doc = "import y from './in-a-string'";
            const tpl = `require("./in-a-template")`;
            import real from "./real";
        "#;
        assert_eq!(imports(src), vec!["./real"]);
    }

    #[test]
    fn ignores_member_calls_named_require() {
        let src = r#"
            mod.require("./not-a-module");
            const r = require("./yes");
        "#;
        assert_eq!(imports(src), vec!["./yes"]);
    }

    #[test]
    fn handles_multiline_and_type_only_imports() {
        let src = r#"
            import {
              alpha,
              beta,
            } from "./wrapped";
            import type { Gamma } from "./types";
        "#;
        assert_eq!(imports(src), vec!["./types", "./wrapped"]);
    }

    #[test]
    fn parses_tsx_generics_and_jsx() {
        let src = r#"
            import React from "react";
            const El = () => <div className="x">{"</div>"}</div>;
        "#;
        assert_eq!(
            extract_imports("a.tsx", src).expect("parses"),
            vec!["react"]
        );
    }

    #[test]
    fn deduplicates_repeated_specifiers() {
        let src = r#"
            import { a } from "./same";
            import { b } from "./same";
            const c = require("./same");
        "#;
        assert_eq!(imports(src), vec!["./same"]);
    }

    #[test]
    fn returns_none_for_non_js_paths() {
        assert!(extract_imports("main.go", "import \"fmt\"").is_none());
        assert!(extract_imports("README.md", "import x from 'y'").is_none());
    }

    #[test]
    fn declines_unparseable_source_so_caller_can_fall_back() {
        // oxc empties `program` on any syntax error, which would leave the visitor blind to
        // `require()`. Returning None routes the file to the regex pass rather than under-reporting.
        let src = r#"
            import ok from "./ok";
            const legacy = require("./legacy");
            function broken( {
        "#;
        assert!(extract_imports("a.ts", src).is_none());
    }

    #[test]
    fn unsafe_calls_find_real_sites_not_strings_or_comments() {
        let src = [
            "const warning = 'never use eval() in production';",
            "// remember: eval() is dangerous",
            "const result = eval(userInput);",
            "cp.exec('ls');",
            "const f = new Function('a', 'return a + 1');",
        ]
        .join("\n");
        let hits = find_unsafe_calls("src/danger.ts", &src).expect("parses");
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].label, "eval()");
        assert_eq!(hits[0].callee, "eval");
        assert_eq!(hits[0].line, 3);
        assert_eq!(hits[1].label, "child_process exec/spawn");
        assert_eq!(hits[1].callee, "cp.exec");
        assert_eq!(hits[1].line, 4);
        assert_eq!(hits[2].label, "new Function()");
        assert_eq!(hits[2].line, 5);
    }

    #[test]
    fn unsafe_calls_decline_skipped_and_non_js() {
        assert!(find_unsafe_calls("src/a.test.ts", "eval(x)").is_none());
        assert!(find_unsafe_calls("app.py", "eval(x)").is_none());
    }
}
