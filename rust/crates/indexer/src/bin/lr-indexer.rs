//! `lr-indexer` — the native binary the E2B sandbox (deep tier) and the benchmark invoke.
//!
//! Modes:
//!   - `lr-indexer <dir>`           — walk a directory on disk and index it (no JSON input; the fast path).
//!   - `lr-indexer` (stdin)         — read a JSON array of `{ path, content }` and index it.
//!   - `lr-indexer --imports`       — same stdin input, emit `[{ path, imports }]` (AST-backed).
//!   - `lr-indexer --unsafe-calls`  — same stdin input, emit `[{ path, hits }]` for handled files.
//!
//! Index modes write `RepoIndex` JSON (camelCase, matching the TypeScript `RepoIndex`) to stdout.
//! Analysis only — no business logic.

use std::io::{self, Read, Write};

fn read_stdin_or_exit() -> String {
    let mut input = String::new();
    if io::stdin().read_to_string(&mut input).is_err() {
        std::process::exit(1);
    }
    input
}

fn write_or_exit(output: &str) {
    if io::stdout().write_all(output.as_bytes()).is_err() {
        std::process::exit(1);
    }
}

fn main() {
    match std::env::args().nth(1) {
        Some(arg) if arg == "--imports" => {
            write_or_exit(&launchreadyy_indexer::extract_imports_json(
                &read_stdin_or_exit(),
            ));
        }
        Some(arg) if arg == "--unsafe-calls" => {
            write_or_exit(&launchreadyy_indexer::extract_unsafe_calls_json(
                &read_stdin_or_exit(),
            ));
        }
        Some(dir) => match launchreadyy_indexer::index_dir_json(&dir) {
            Some(json) => write_or_exit(&json),
            None => std::process::exit(1),
        },
        None => {
            write_or_exit(&launchreadyy_indexer::index_files_json(
                &read_stdin_or_exit(),
            ));
        }
    }
}
