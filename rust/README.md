# LaunchReadyy Rust workspace (v2 Phase 5)

Accelerates repository **analysis only** — file indexing, hashing, directory traversal, secret
pre-filtering, AST import extraction, and dependency-edge building. **No business logic lives here.**
Every algorithm has a tested TypeScript reference (`src/lib/indexer/`,
`src/lib/scan-engine/incremental.ts`, `src/lib/graph/`); Rust is a drop-in accelerator gated by the
`flag_rust_indexer` feature flag. If the artifact is absent, the TypeScript path runs unchanged.

Note the boundary for the graph: Rust extracts each file's import specifiers, and TypeScript's
`buildDependencyGraph` still resolves them and assigns node kinds and layers. Rust parses; TS decides.

## Layout

```
rust/
  Cargo.toml                     workspace
  Cargo.lock                     committed (there is a binary → reproducible builds)
  crates/indexer/
    Cargo.toml
    src/
      lib.rs        index_files() + extract_imports_files() + JSON entry points
      hash.rs       FNV-1a (UTF-16 parity with the TS hashContent)
      traversal.rs  should_index() filter + native walk_dir()
      secrets.rs    high-signal secret candidate pre-filter
      ast.rs        AST import extraction via oxc (JS/TS)
      graph.rs      import resolution + dependency-edge building (+ regex fallback)
      bin/lr-indexer.rs   stdin/dir JSON bridge (the sandbox/bench entry point)
    tests/
      parity.rs           asserts fnv1a_hex == the shared hash-parity fixture
      hash-parity.json    shared fixture (TS asserts the same file)
```

## Binary modes

| Invocation             | Input                       | Output                                          |
| ---------------------- | --------------------------- | ----------------------------------------------- |
| `lr-indexer <dir>`     | directory on disk           | `RepoIndex` JSON (fastest — no JSON in)         |
| `lr-indexer`           | `[{path,content}]` on stdin | `RepoIndex` JSON                                |
| `lr-indexer --imports`      | `[{path,content}]` on stdin | `[{path,imports}]` — feeds the TS graph builder |
| `lr-indexer --unsafe-calls` | `[{path,content}]` on stdin | `[{path,hits}]` — handled files only (AST unsafe calls) |

## Import extraction

`ast.rs` parses JS/TS with [oxc](https://oxc.rs) (pure Rust, so the crate still targets
`wasm32-unknown-unknown`). Static ESM specifiers come from `ModuleRecord::requested_modules` — the
spec's `[[RequestedModules]]`, which covers `import`, bare `import "x"`, `export … from` and
`export *`. A visitor adds the non-ESM forms: `require()`, dynamic `import()`, and TypeScript's
`import x = require()`.

Parsing removes a whole class of regex error — a commented-out or stringified import is no longer
reported as a dependency, and `foo.require("x")` no longer counts.

`graph::extract_imports_for` mirrors the TypeScript path in `src/lib/graph/index.ts` exactly, because
an accelerator that changed the graph would not be a drop-in:

| File                                  | Result                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| JS/TS that parses                     | the AST result                                                |
| JS/TS that fails to parse             | `extract_imports_regex`                                       |
| `.d.ts`, minified, bundled, test/spec | no imports (mirrors `SKIP` in `scanner/ast/language.ts`)      |
| non-JS languages (Go, Python, …)      | no imports (the TS regex branch is gated on a JS/TS language) |

The parse-failure row matters: oxc empties its program on _any_ syntax error, which would leave the
visitor blind to `require()`, so a failure declines to regex rather than under-reporting edges.

## Build

Requires the Rust toolchain (`cargo`, `rustc`); WASM additionally needs `wasm-pack`.

```sh
# Unit + integration tests (incl. hash parity)
cargo test --manifest-path rust/Cargo.toml

# Native lib + the lr-indexer binary → rust/target/release (deep tier / E2B sandbox)
cargo build --release --manifest-path rust/Cargo.toml

# WASM build for bounded indexing operations → rust/crates/indexer/pkg (gitignored)
# NOTE: --features goes after `--` (cargo passthrough); use a prebuilt wasm-pack if install fails.
wasm-pack build rust/crates/indexer --target web -- --features wasm
```

Or via npm scripts (from the repo root):

```sh
npm run rust:test          # cargo test
npm run rust:build         # release build (native + lr-indexer binary)
npm run wasm:build         # wasm-pack build (needs wasm-pack on PATH)
npm run bench:indexer      # TS vs Rust JSON-bridge benchmark
npm run bench:indexer:disk src   # TS vs Rust disk-walk on a real directory
npm run bench:imports src        # TS AST vs Rust --imports on a real directory
```

## Status (verified 2026-07-30)

- ✅ Compiles clean; **28 Rust tests pass** (`cargo test`), clippy clean at `-D warnings`.
- ✅ **CI covers Rust**: the `rust` job runs fmt/clippy/test plus a `wasm32-unknown-unknown` build;
  the `rust-parity` job builds both `lr-indexer` and the wasm-pack artifact first, so the gated
  parity suites actually execute instead of silently passing, and fails loudly if either is missing.
- ✅ **Import parity proven**: `src/lib/graph/rust-imports.test.ts` asserts the Rust `--imports`
  output equals the TS AST layer's `findImports`, and that both backends yield the same graph. On the
  real `src/` tree (545 files) both produce **1830 specifiers with zero divergence**.
- ✅ **Hash parity proven**: `hash::fnv1a_hex` matches the TS `hashContent` for ASCII, `café`, CJK,
  and emoji surrogate pairs, asserted on both sides against `tests/hash-parity.json`.
- ✅ **Functional parity proven**: `src/lib/indexer/rust-backend.test.ts` spawns the real
  `lr-indexer` binary and asserts identical file set / hashes / sizes / line counts vs the TS
  reference (`size` = UTF-8 bytes on both sides; `lines` via `str::lines()` semantics).
- ✅ **WASM builds and is parity-verified**: `wasm-pack build ... -- --features wasm` produces
  `pkg/` (glue + ~1 MB `.wasm`); `src/lib/indexer/wasm.test.ts` loads it via `initSync(bytes)` (no
  fetch — how a Worker loads it) and asserts `fnv1a_hex` / `index_files_json` /
  `extract_imports_json` match the TS reference. `pkg/` is gitignored; CI's `rust-parity` job runs
  `wasm-pack` so this suite executes there rather than skipping.
- ✅ **WASM wired into the Worker selectors**: `src/lib/indexer/wasm-backend.server.ts` imports the
  glue + `.wasm` (no `node:` builtins). `getIndexer` / `getImportsExtractor` prefer native binary →
  WASM → TS when `flag_rust_indexer` is on. `npm run build` runs `scripts/ensure-wasm.mjs` so the
  artifact exists before Vite; the deploy job builds wasm-pack and waits on `rust-parity`. Flag stays
  `defaultEnabled: false` until a staged smoke test.

> Toolchain note: `cargo install wasm-pack` fails here (GNU host toolchain, missing mingw `dlltool`);
> the **prebuilt** `wasm-pack` binary works. `wasm32-unknown-unknown` target is installed via rustup.

## Benchmark & adoption decision

Two invocation modes were measured — the result flips between them, which is the whole point.

**JSON bridge** (`npx tsx scripts/bench-indexer.ts`, 300k LOC synthetic, content piped as JSON):

| Path                              | Time    |
| --------------------------------- | ------- |
| TS reference (in-process)         | ~192 ms |
| Rust via stdin/stdout JSON bridge | ~315 ms |

→ **Rust loses (0.61×).** JSON (de)serialization + process-spawn overhead outweighs the faster hashing.

**Native disk-walk** (`npx tsx scripts/bench-indexer-disk.ts src`, 529 real files, both read from disk):

| Path                    | Time    |
| ----------------------- | ------- |
| TS (fs read + index)    | ~427 ms |
| Rust `lr-indexer <dir>` | ~165 ms |

→ **Rust wins (2.58×)** when it reads files itself — no JSON round-trip.

**Decision:** for **indexing**, prefer the disk-walk path (`lr-indexer <dir>`) in the deep tier.
The Worker uses WASM (`index_files_json`) when `flag_rust_indexer` is on — no spawn, still a JSON
string bridge, but that's the only option without a filesystem. Native binary still wins over WASM
when both exist (local Node / sandbox).

**Import extraction flips the JSON-bridge conclusion** (`npx tsx scripts/bench-imports.ts src`, 545 real files,
3.08 MB):

| Path                                 | Time     |
| ------------------------------------ | -------- |
| TS AST per-file (`findImports`)      | ~3965 ms |
| Rust `--imports` via the JSON bridge | ~147 ms  |

→ **Rust wins (~27×)** _even through the JSON bridge_. Indexing only hashes, so serialization
dominated; parsing is expensive enough that the bridge cost disappears next to it. Same mechanism,
opposite verdict — which is why the accelerator is selected per operation, not once globally.

> ⚠️ Benchmark caveat: `bench-indexer-disk.ts` with **no argument** writes a fresh repo to `%TEMP%`; on
> Windows, Defender real-time-scans those brand-new files every time the unsigned binary opens them,
> which inflated Rust to ~27 s (an AV artifact, not the code — the binary indexes 352 real files in
> 189 ms). Always benchmark against a **real, already-scanned** directory (pass a path argument). The
> Linux sandbox has no such interference.

**WASM in the Worker (Task 3):** wired via `wasm-backend.server.ts` + selectors. Enable with
`flag_rust_indexer` (still default off). Rebuild the artifact with `npm run wasm:build` before
`npm run build` if `pkg/` is missing.

## Parity contract

`fnv1a_hex` iterates UTF-16 code units, so its output is byte-identical to the JS `hashContent`.
This keeps content-addressed cache keys stable regardless of which path produced them — a
prerequisite for mixing the TS and Rust indexers behind the same cache.
