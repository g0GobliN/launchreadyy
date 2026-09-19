//! LaunchReadyy accelerated indexer (v2 Phase 5) — analysis only, no business logic.
//!
//! Mirrors the TypeScript reference in `src/lib/indexer/`, `src/lib/scan-engine/incremental.ts`, and
//! `src/lib/graph/`. Every algorithm has a tested TS counterpart; this crate is a drop-in accelerator
//! selected by `flag_rust_indexer`. When its artifact is absent, the TS path runs unchanged.
//!
//! Modules:
//! - [`hash`] — FNV-1a content hashing (UTF-16 parity with the TS side).
//! - [`traversal`] — indexable-path filter (+ native directory walker).
//! - [`secrets`] — high-signal secret candidate pre-filter.
//! - [`graph`] — import resolution and dependency-edge building.
//! - [`ast`] — AST-backed import extraction for JS/TS (regex fallback for everything else).

pub mod ast;
pub mod graph;
pub mod hash;
pub mod secrets;
pub mod traversal;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct SourceFile {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct FileMeta {
    pub path: String,
    pub hash: String,
    pub size: usize,
    pub lines: usize,
}

/// The indexer's single-pass output: per-file metadata plus a secret pre-filter sweep.
/// camelCase so the JSON matches the TypeScript `RepoIndex` shape byte-for-byte across the bridge.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoIndex {
    pub files: Vec<FileMeta>,
    pub total_bytes: usize,
    pub total_lines: usize,
    pub secrets: Vec<secrets::SecretCandidate>,
}

fn line_count(content: &str) -> usize {
    // `str::lines()` matches the TS reference: a trailing newline is not an extra line.
    if content.is_empty() {
        0
    } else {
        content.lines().count()
    }
}

/// Build the index over the given files in a single pass, skipping non-indexable paths.
pub fn index_files(files: &[SourceFile]) -> RepoIndex {
    let mut metas = Vec::with_capacity(files.len());
    let mut total_bytes = 0usize;
    let mut total_lines = 0usize;
    let mut all_secrets = Vec::new();

    for f in files {
        if !traversal::should_index(&f.path) {
            continue;
        }
        let size = f.content.len();
        let lines = line_count(&f.content);
        total_bytes += size;
        total_lines += lines;
        metas.push(FileMeta {
            path: f.path.clone(),
            hash: hash::fnv1a_hex(&f.content),
            size,
            lines,
        });
        all_secrets.extend(secrets::sweep(&f.path, &f.content, 20));
    }

    RepoIndex {
        files: metas,
        total_bytes,
        total_lines,
        secrets: all_secrets,
    }
}

/// JSON in/out entry point shared by the native binary and the WASM build.
pub fn index_files_json(input_json: &str) -> String {
    let files: Vec<SourceFile> = serde_json::from_str(input_json).unwrap_or_default();
    serde_json::to_string(&index_files(&files)).unwrap_or_else(|_| "{}".to_string())
}

/// One file's module specifiers — the TS `FileImports` shape.
#[derive(Serialize)]
pub struct FileImportsOut {
    pub path: String,
    pub imports: Vec<String>,
}

/// Per-file import specifiers (AST for JS/TS, regex otherwise).
///
/// This is the boundary the TypeScript side consumes: Rust does the parsing, and
/// `buildDependencyGraph` keeps resolution, node kinds and layers in TS where the business logic
/// lives. Kept out of [`index_files`] because the index feeds content-addressed incremental scans and
/// is requested far more often, so per-file import lists do not belong in its payload.
///
/// Returns one entry per input file, in order, including files that contribute no imports.
/// Deliberately does *not* apply `traversal::should_index`: the TS graph builder turns every entry
/// into a node, so dropping files here would produce a smaller node set than the TS path and break
/// the drop-in contract. Filtering is the indexer's concern, not the graph's.
pub fn extract_imports_files(files: &[SourceFile]) -> Vec<FileImportsOut> {
    files
        .iter()
        .map(|f| FileImportsOut {
            path: f.path.clone(),
            imports: graph::extract_imports_for(&f.path, &f.content),
        })
        .collect()
}

/// JSON in/out per-file import extraction, shared by the native binary and the WASM build.
pub fn extract_imports_json(input_json: &str) -> String {
    let files: Vec<SourceFile> = serde_json::from_str(input_json).unwrap_or_default();
    serde_json::to_string(&extract_imports_files(&files)).unwrap_or_else(|_| "[]".to_string())
}

/// One file's unsafe-call hits — only emitted when the AST path handled the file.
#[derive(Serialize)]
pub struct FileUnsafeOut {
    pub path: String,
    pub hits: Vec<ast::UnsafeCallHit>,
}

/// Per-file unsafe calls for files the AST path can handle.
///
/// Files that are skipped / non-JS / unparseable are **omitted** (not empty) — the TypeScript
/// `findUnsafeCalls` / regex path must cover those. Same drop-in rule as imports: never change
/// which files the AST claims to have handled.
pub fn extract_unsafe_calls_files(files: &[SourceFile]) -> Vec<FileUnsafeOut> {
    files
        .iter()
        .filter_map(|f| {
            ast::find_unsafe_calls(&f.path, &f.content).map(|hits| FileUnsafeOut {
                path: f.path.clone(),
                hits,
            })
        })
        .collect()
}

/// JSON in/out unsafe-call extraction for the native binary and WASM.
pub fn extract_unsafe_calls_json(input_json: &str) -> String {
    let files: Vec<SourceFile> = serde_json::from_str(input_json).unwrap_or_default();
    serde_json::to_string(&extract_unsafe_calls_files(&files)).unwrap_or_else(|_| "[]".to_string())
}

/// Index a repository directly from disk (deep tier / E2B sandbox) — walk + read + index natively,
/// with no JSON input to (de)serialize. This is the path where Rust's traversal/hashing dominates
/// (see the benchmark in rust/README.md). Native only; the Worker uses the JSON/WASM entry instead.
#[cfg(not(target_arch = "wasm32"))]
pub fn index_dir(root: &std::path::Path) -> std::io::Result<RepoIndex> {
    let rels = traversal::walk_dir(root)?;
    let mut files = Vec::with_capacity(rels.len());
    for rel in rels {
        // Non-UTF-8 / unreadable files are skipped, not fatal.
        if let Ok(content) = std::fs::read_to_string(root.join(&rel)) {
            files.push(SourceFile { path: rel, content });
        }
    }
    Ok(index_files(&files))
}

/// `index_dir` → JSON, or None on an I/O/serialization error.
#[cfg(not(target_arch = "wasm32"))]
pub fn index_dir_json(root: &str) -> Option<String> {
    serde_json::to_string(&index_dir(std::path::Path::new(root)).ok()?).ok()
}

#[cfg(feature = "wasm")]
mod wasm {
    use wasm_bindgen::prelude::*;

    /// WASM export for bounded indexing work.
    #[wasm_bindgen]
    pub fn index_files_json(input_json: &str) -> String {
        super::index_files_json(input_json)
    }

    /// WASM export for a single content hash (matches the TS `hashContent`).
    #[wasm_bindgen]
    pub fn fnv1a_hex(s: &str) -> String {
        super::hash::fnv1a_hex(s)
    }

    /// WASM export for AST-backed per-file import extraction (the TS `FileImports` shape).
    #[wasm_bindgen]
    pub fn extract_imports_json(input_json: &str) -> String {
        super::extract_imports_json(input_json)
    }

    /// WASM export for AST-backed unsafe-call detection (the TS `UnsafeCallHit` list per file).
    #[wasm_bindgen]
    pub fn extract_unsafe_calls_json(input_json: &str) -> String {
        super::extract_unsafe_calls_json(input_json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_files_and_counts_lines() {
        let files = vec![
            SourceFile {
                path: "a.ts".into(),
                content: "line1\nline2\n".into(),
            },
            SourceFile {
                path: "node_modules/dep/index.js".into(),
                content: "skip me".into(),
            },
        ];
        let idx = index_files(&files);
        assert_eq!(idx.files.len(), 1); // node_modules filtered out
        assert_eq!(idx.files[0].lines, 2);
        assert_eq!(idx.total_lines, 2);
    }

    #[test]
    fn json_roundtrip_is_valid() {
        let out = index_files_json(r#"[{"path":"a.ts","content":"x"}]"#);
        assert!(out.contains("\"files\""));
    }

    #[test]
    fn extracts_local_and_bare_specifiers_per_file() {
        let files = vec![
            SourceFile {
                path: "src/a.ts".into(),
                content: "import { b } from './b';\nimport react from 'react';".into(),
            },
            SourceFile {
                path: "src/b.ts".into(),
                content: "export const b = 1;".into(),
            },
        ];
        let out = extract_imports_files(&files);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].imports, vec!["./b", "react"]);
        assert!(out[1].imports.is_empty());
    }

    #[test]
    fn extraction_ignores_imports_in_comments() {
        // The whole point of the AST path: a commented-out import is not a dependency.
        let files = vec![SourceFile {
            path: "src/a.ts".into(),
            content: "// import ghost from 'ghost-pkg';\nimport react from 'react';".into(),
        }];
        assert_eq!(extract_imports_files(&files)[0].imports, vec!["react"]);
    }

    #[test]
    fn keeps_an_entry_for_every_input_file() {
        // The TS graph builder makes a node per entry, so nothing may be filtered out here.
        let files = vec![
            SourceFile {
                path: "public/app.min.js".into(),
                content: "var a=require('jquery');".into(),
            },
            SourceFile {
                path: "cmd/main.go".into(),
                content: "import \"fmt\"".into(),
            },
        ];
        let out = extract_imports_files(&files);
        assert_eq!(out.len(), 2, "no file may be dropped");
        assert!(out.iter().all(|f| f.imports.is_empty()));
    }

    #[test]
    fn imports_json_emits_the_ts_file_imports_shape() {
        let out = extract_imports_json(r#"[{"path":"a.ts","content":"import 'react';"}]"#);
        assert!(out.contains("\"path\""), "got {out}");
        assert!(out.contains("\"imports\""), "got {out}");
        assert!(out.contains("react"), "got {out}");
    }
}
