/**
 * Ensure the wasm-pack artifact is present *and current* before `vite build` (the Worker imports
 * it). Presence alone is not enough: this used to skip whenever pkg/ existed, so an artifact built
 * before a new `#[wasm_bindgen]` export was added stayed in place indefinitely. The Worker then
 * bundled a module missing that export, `tsc` failed with TS2614 on an import that is genuinely
 * correct, and the wasm parity suite — gated on the artifact existing — ran against the old build
 * instead of skipping. Rebuild whenever the crate is newer than the artifact.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const CRATE = "rust/crates/indexer";
const WASM = `${CRATE}/pkg/launchreadyy_indexer_bg.wasm`;

/** Everything whose change alters the built artifact. The workspace root matters as much as the
 * crate: rust/Cargo.toml carries [profile.release] (opt-level, lto, codegen-units), which is the
 * profile wasm-pack builds under, and Cargo.lock is where a transitive dependency bump lands
 * without touching either manifest. Watching only the crate would leave the same
 * presence-mistaken-for-currency hole this check exists to close, one level up. */
const SOURCES = [`${CRATE}/src`, `${CRATE}/Cargo.toml`, "rust/Cargo.toml", "rust/Cargo.lock"];

/** Newest mtime under a path, walking directories. 0 when it does not exist. */
function newestMtime(target) {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(target).reduce(
    (newest, entry) => Math.max(newest, newestMtime(path.join(target, entry))),
    0,
  );
}

if (existsSync(WASM)) {
  const built = statSync(WASM).mtimeMs;
  const source = Math.max(...SOURCES.map(newestMtime));
  if (source <= built) {
    process.exit(0);
  }
  console.log("WASM artifact is older than the crate — rebuilding…");
} else {
  console.log("WASM artifact missing — running npm run wasm:build…");
}

const result = spawnSync("npm", ["run", "wasm:build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status === null ? 1 : result.status);
