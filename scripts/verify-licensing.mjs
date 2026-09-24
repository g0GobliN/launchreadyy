#!/usr/bin/env node
/**
 * Fail when the project's licensing identity drifts.
 *
 * The repository makes promises that nothing else verifies: the code is Apache-2.0, the brand
 * carve-out is stated next to the license, and every shipped manifest agrees. A license is the one
 * thing a contributor can change by accident — a copy-paste from another repository, a "let's just
 * use MIT" pull request, a `files` allowlist that quietly drops NOTICE from the published tarball —
 * and no test would notice, because nothing imports a license.
 *
 * Scope is deliberately the project's own manifests. Everything under fixtures/ simulates an
 * arbitrary user repository, including ones whose licenses LaunchReadyy is meant to flag, so
 * fixtures are excluded here and must stay excluded.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_LICENSE = "Apache-2.0";

/** Third-party code, generated output, and fixture repositories — never project manifests. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".output",
  ".vinxi",
  "target",
  "fixtures",
  "data",
]);

/**
 * Generated trees whose directory *names* are unremarkable, so they need matching by path.
 * wasm-pack writes a package.json of its own into the indexer's `pkg/`, with a `files` allowlist
 * that has nothing to do with how this repository is published.
 */
const SKIP_PATHS = ["rust/crates/indexer/pkg"];

/** Files that travel together. docs/reference/19-tool-licensing.md explains what each one covers. */
const REQUIRED_FILES = ["LICENSE", "NOTICE", "TRADEMARKS.md"];

/** Markers of an intact Apache-2.0 text. Their absence means the file is not that license. */
const LICENSE_MARKERS = [
  "Apache License",
  "Version 2.0, January 2004",
  "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
  "END OF TERMS AND CONDITIONS",
];

const problems = [];

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

/** Every file under `dir`, skipping third-party/generated/fixture trees and dot-directories. */
function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (SKIP_PATHS.some((skip) => rel === skip || rel.startsWith(`${skip}/`))) continue;
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

const packageJsons = [];
const cargoManifests = [];
walk(root, (file) => {
  if (file.endsWith("package.json")) packageJsons.push(file);
  else if (file.endsWith("Cargo.toml")) cargoManifests.push(file);
});

for (const name of REQUIRED_FILES) {
  if (!existsSync(path.join(root, name))) {
    problems.push(
      `${name} is missing. LICENSE, NOTICE, and TRADEMARKS.md are distributed together; ` +
        `see docs/reference/19-tool-licensing.md.`,
    );
  } else if (read(name).trim() === "") {
    problems.push(`${name} is empty.`);
  }
}

// A relicensing is a legitimate change, but it is a multi-file change: this check exists so it
// cannot happen by halves — a new LICENSE next to the old package.json metadata is the failure
// mode, not the relicensing itself.
if (existsSync(path.join(root, "LICENSE"))) {
  const license = read("LICENSE");
  const missing = LICENSE_MARKERS.filter((marker) => !license.includes(marker));
  if (missing.length > 0) {
    problems.push(
      `LICENSE is not the ${EXPECTED_LICENSE} text (missing "${missing[0]}"). To relicense, ` +
        `update LICENSE, NOTICE, package.json, the Cargo manifests, this check, and ` +
        `docs/reference/19-tool-licensing.md together.`,
    );
  }
}

if (existsSync(path.join(root, "NOTICE"))) {
  const notice = read("NOTICE");
  if (!notice.includes("Apache")) {
    problems.push(`NOTICE no longer names the license the software is distributed under.`);
  }
  // The NOTICE is where a redistributor learns the code license grants no brand rights, and
  // Apache-2.0 §4(d) is why the notice file has to travel with the code at all.
  if (!notice.includes("TRADEMARKS.md")) {
    problems.push(`NOTICE no longer points at TRADEMARKS.md, so the brand carve-out is unstated.`);
  }
}

for (const file of packageJsons) {
  const rel = path.relative(root, file);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${rel} is not valid JSON: ${error.message}`);
    continue;
  }
  if (manifest.license !== EXPECTED_LICENSE) {
    problems.push(
      `${rel} declares ${manifest.license ? `"${manifest.license}"` : "no license"} — ` +
        `expected "${EXPECTED_LICENSE}".`,
    );
  }
  // npm always bundles LICENSE and README regardless of `files`, but not NOTICE. Adding a
  // `files` allowlist would therefore strip the attribution file from the published tarball
  // while the docs still claim distributions include it.
  if (Array.isArray(manifest.files)) {
    const includesNotice = manifest.files.some(
      (entry) => typeof entry === "string" && entry.replace(/^!/, "").startsWith("NOTICE"),
    );
    if (!includesNotice) {
      problems.push(`${rel} has a "files" allowlist that omits NOTICE.`);
    }
  }
}

/**
 * Minimal TOML scan for the package license metadata. These manifests are flat and hand-written,
 * and adding a TOML parser to grade four files is not worth the dependency. Section headers are
 * tracked so a dependency named `license` cannot masquerade as package metadata.
 */
function cargoLicense(text) {
  const found = { scope: false, license: null, inheritsWorkspace: false, licenseFile: null };
  let section = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]/);
    if (header) {
      section = header[1].trim();
      if (section === "package" || section === "workspace.package") found.scope = true;
      continue;
    }
    if (section !== "package" && section !== "workspace.package") continue;
    const license = line.match(/^license\s*=\s*"([^"]*)"/);
    if (license) {
      found.license = license[1];
      continue;
    }
    if (/^license\.workspace\s*=\s*true\b/.test(line)) found.inheritsWorkspace = true;
    const licenseFile = line.match(/^license-file\s*=\s*"([^"]*)"/);
    if (licenseFile) found.licenseFile = licenseFile[1];
  }
  return found;
}

const manifests = cargoManifests.map((file) => {
  const rel = path.relative(root, file).split(path.sep).join("/");
  return { rel, ...cargoLicense(readFileSync(file, "utf8")) };
});
const workspaceLicense = manifests.find((m) => m.rel.includes("workspace"))?.license ?? null;

for (const manifest of manifests) {
  if (!manifest.scope) continue; // Pure [workspace] root with no package metadata of its own.
  if (manifest.licenseFile) {
    problems.push(
      `${manifest.rel} points at a license file ("${manifest.licenseFile}") instead of the SPDX ` +
        `identifier "${EXPECTED_LICENSE}".`,
    );
    continue;
  }
  if (manifest.inheritsWorkspace) {
    if (workspaceLicense !== EXPECTED_LICENSE) {
      problems.push(
        `${manifest.rel} inherits its license from [workspace.package], which declares ` +
          `${workspaceLicense ? `"${workspaceLicense}"` : "nothing"}.`,
      );
    }
    continue;
  }
  if (manifest.license !== EXPECTED_LICENSE) {
    problems.push(
      `${manifest.rel} declares ${manifest.license ? `"${manifest.license}"` : "no license"} — ` +
        `expected "${EXPECTED_LICENSE}".`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    `Licensing check failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
  );
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nThe licensing model is documented in docs/reference/19-tool-licensing.md.");
  process.exit(1);
}

const checked = packageJsons.length + manifests.filter((m) => m.scope).length;
console.log(`Licensing check OK — ${EXPECTED_LICENSE} across ${checked} manifests.`);
