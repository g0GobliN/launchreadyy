import { ARCH_SCAN_UNSUPPORTED_MESSAGE } from "../project-context";
import {
  pickArchProfile,
  buildArchResolveCtx,
  type ArchLangProfile,
  type ArchResolveCtx,
} from "../arch-lang-profiles";
import type { RichFileProvider } from "./file-provider";

const OVERSIZED_BYTES = 15_000;
const MAX_FILES_TO_FETCH = 60;
const SCORE_WEIGHTS = {
  circularDep: 20,
  deadFile: 3,
  unusedPackage: 5,
  oversizedFile: 5,
  separationIssue: 10,
  duplicateLogic: 5,
};

export interface ArchFinding {
  id: string;
  type:
    | "circular-dep"
    | "dead-file"
    | "unused-package"
    | "oversized-file"
    | "separation-issue"
    | "duplicate-logic";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  files: string[];
  /** What the arch scanner looked for — mirrors Issue.checkedFor. */
  checkedFor?: string[];
  /** Concrete evidence of the finding — mirrors Issue.foundEvidence. */
  foundEvidence?: string;
  aiExplanation?: string;
}

export interface ArchScanResult {
  score: number;
  findings: ArchFinding[];
  scannedFiles: number;
}

interface TreeNode {
  path: string;
  size: number;
}

function buildTreeNodes(provider: RichFileProvider, paths: string[]): TreeNode[] {
  return paths.map((path) => ({
    path,
    size: provider.fileSize(path) ?? 0,
  }));
}

function buildGraph(
  files: Record<string, string>,
  profile: ArchLangProfile,
  ctx: ArchResolveCtx,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const [filePath, content] of Object.entries(files)) {
    const edges = new Set<string>();
    for (const spec of profile.parseImports(content)) {
      for (const resolved of profile.resolve(filePath, spec, ctx)) {
        if (resolved !== filePath) edges.add(resolved);
      }
    }
    graph.set(filePath, edges);
  }
  return graph;
}

function externalImports(
  content: string,
  filePath: string,
  profile: ArchLangProfile,
  ctx: ArchResolveCtx,
): string[] {
  const out: string[] = [];
  for (const spec of profile.parseImports(content)) {
    if (profile.resolve(filePath, spec, ctx).length > 0) continue;
    const name = profile.externalName(spec, ctx);
    if (name) out.push(name);
  }
  return out;
}

function detectCycles(graph: Map<string, Set<string>>): string[][] {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const n of graph.keys()) color.set(n, WHITE);
  const cycles: string[][] = [];

  function dfs(v: string, path: string[]) {
    color.set(v, GRAY);
    for (const u of graph.get(v) ?? []) {
      const s = color.get(u);
      if (s === GRAY) {
        const idx = path.indexOf(u);
        if (idx !== -1) cycles.push([...path.slice(idx), v, u]);
      } else if (s === WHITE) {
        dfs(u, [...path, v]);
      }
    }
    color.set(v, BLACK);
  }

  for (const n of graph.keys()) {
    if (color.get(n) === WHITE) dfs(n, []);
  }

  const seen = new Set<string>();
  return cycles.filter((c) => {
    const key = [...c].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findDeadFiles(graph: Map<string, Set<string>>, entryPoints: Set<string>): string[] {
  const reachable = new Set<string>();
  function traverse(n: string) {
    if (reachable.has(n)) return;
    reachable.add(n);
    for (const c of graph.get(n) ?? []) traverse(c);
  }
  for (const e of entryPoints) traverse(e);
  return [...graph.keys()].filter((f) => !reachable.has(f));
}

function findUnusedPackages(
  manifestContent: string,
  allFiles: Record<string, string>,
  profile: ArchLangProfile,
  ctx: ArchResolveCtx,
): string[] {
  if (!profile.manifest) return [];
  const declared = profile.manifest.parseDeps(manifestContent);
  const used = new Set<string>();
  for (const [path, content] of Object.entries(allFiles)) {
    for (const name of externalImports(content, path, profile, ctx)) {
      used.add(name.toLowerCase().replace(/-/g, "_"));
      used.add(name);
    }
  }
  const isUsed = (dep: string) =>
    profile.manifest!.matches
      ? profile.manifest!.matches(dep, used)
      : profile.manifest!.usedForms(dep).some((form) => used.has(form));
  return declared.filter((dep) => !isUsed(dep));
}

function findOversizedFiles(tree: TreeNode[], profile: ArchLangProfile): string[] {
  return tree
    .filter((n) => profile.isSource(n.path) && n.size > OVERSIZED_BYTES)
    .map((n) => n.path);
}

function checkSeparation(files: Record<string, string>): string[] {
  const issues: string[] = [];
  const DB_IMPORTS = /supabase|prisma|mongoose|sequelize|typeorm|drizzle/;

  for (const [path, content] of Object.entries(files)) {
    const isClientRoute =
      (path.includes("/routes/") || path.includes("/pages/")) &&
      !path.endsWith(".server.ts") &&
      !path.endsWith(".server.tsx");
    const isComponent =
      path.includes("/components/") &&
      !path.endsWith(".server.ts") &&
      !path.endsWith(".server.tsx");

    if ((isClientRoute || isComponent) && DB_IMPORTS.test(content)) {
      issues.push(path);
    }
  }
  return issues;
}

function findDuplicateLogic(
  files: Record<string, string>,
  profile: ArchLangProfile,
  ctx: ArchResolveCtx,
): string[][] {
  const importSig = new Map<string, string[]>();
  for (const [path, content] of Object.entries(files)) {
    const pkgs = [...new Set(externalImports(content, path, profile, ctx))].sort().join(",");
    if (pkgs.split(",").length < 3) continue;
    (importSig.get(pkgs) ?? importSig.set(pkgs, []).get(pkgs)!).push(path);
  }
  return [...importSig.values()].filter((g) => g.length >= 2).map((g) => g.slice(0, 3));
}

function calcArchScore(findings: ArchFinding[]): number {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.type] = (counts[f.type] ?? 0) + 1;

  let penalty = 0;
  penalty += Math.min(counts["circular-dep"] ?? 0, 2) * SCORE_WEIGHTS.circularDep;
  penalty += Math.min(counts["dead-file"] ?? 0, 5) * SCORE_WEIGHTS.deadFile;
  penalty += Math.min(counts["unused-package"] ?? 0, 4) * SCORE_WEIGHTS.unusedPackage;
  penalty += Math.min(counts["oversized-file"] ?? 0, 3) * SCORE_WEIGHTS.oversizedFile;
  penalty += Math.min(counts["separation-issue"] ?? 0, 2) * SCORE_WEIGHTS.separationIssue;
  penalty += Math.min(counts["duplicate-logic"] ?? 0, 2) * SCORE_WEIGHTS.duplicateLogic;
  return Math.max(0, 100 - penalty);
}

async function readFilesBatch(
  provider: RichFileProvider,
  paths: string[],
  batchSize = 6,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((p) => provider.readFile(p)));
    batch.forEach((p, j) => {
      if (results[j]) out[p] = results[j]!;
    });
  }
  return out;
}

export async function runArchScanCore(provider: RichFileProvider): Promise<ArchScanResult> {
  const paths = await provider.listFiles();
  const tree = buildTreeNodes(provider, paths);
  const treePaths = tree.map((n) => n.path);
  const profile = pickArchProfile(treePaths);
  if (!profile) {
    throw new Error(ARCH_SCAN_UNSUPPORTED_MESSAGE);
  }

  const sourcePaths = tree
    .filter((n) => profile.isSource(n.path) && !n.path.includes(".min."))
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_FILES_TO_FETCH)
    .map((n) => n.path);
  const allSourcePaths = tree.filter((n) => profile.isSource(n.path)).map((n) => n.path);

  const files = await readFilesBatch(provider, sourcePaths);

  const [goMod, pubspec, composerJson] = await Promise.all([
    profile.id === "go" ? provider.readFile("go.mod") : null,
    profile.id === "dart" ? provider.readFile("pubspec.yaml") : null,
    profile.id === "php" ? provider.readFile("composer.json") : null,
  ]);
  const ctx = buildArchResolveCtx(allSourcePaths, { goMod, pubspec, composerJson });

  const manifestContent = profile.manifest
    ? ((await provider.readFile(profile.manifest.path)) ?? "")
    : "";

  const graph = buildGraph(files, profile, ctx);

  const isEntryName = (p: string) => profile.entryNames.some((e) => p === e || p.endsWith(`/${e}`));
  const imported = new Set([...graph.values()].flatMap((s) => [...s]));
  const entryPoints = new Set(Object.keys(files).filter((f) => !imported.has(f) || isEntryName(f)));

  const findings: ArchFinding[] = [];
  let idCounter = 0;
  const id = () => `arch-${++idCounter}`;

  const cycles = profile.cyclesMatter === false ? [] : detectCycles(graph);
  for (const cycle of cycles.slice(0, 5)) {
    findings.push({
      id: id(),
      type: "circular-dep",
      severity: "critical",
      title: `Circular dependency (${cycle.length} files)`,
      detail: `${cycle[0]} → … → ${cycle[cycle.length - 1]}`,
      files: cycle,
      checkedFor: ["import graph cycles across sampled source files"],
      foundEvidence: `Cycle: ${cycle.join(" → ")}.`,
    });
  }

  if (Object.keys(files).length >= 10) {
    const dead = findDeadFiles(graph, entryPoints)
      .filter((f) => !isEntryName(f))
      .slice(0, 8);
    for (const f of dead) {
      findings.push({
        id: id(),
        type: "dead-file",
        severity: "low",
        title: "Unreachable file",
        detail: "No other file imports this module. It may be unused or an orphaned refactor.",
        files: [f],
        checkedFor: ["inbound imports from other sampled modules", "entry-point filenames"],
        foundEvidence: `No sampled file imports ${f}.`,
      });
    }
  }

  let unusedPkgs: string[] = [];
  if (manifestContent) {
    const usedCorpus: Record<string, string> = { ...files };
    const usageFilter = profile.isUsageSource ?? profile.isSource;
    const extraPaths = treePaths.filter((p) => usageFilter(p) && !(p in usedCorpus)).slice(0, 400);
    const extra = await readFilesBatch(provider, extraPaths);
    Object.assign(usedCorpus, extra);
    unusedPkgs = findUnusedPackages(manifestContent, usedCorpus, profile, ctx).slice(0, 6);
  }
  for (const pkg of unusedPkgs) {
    findings.push({
      id: id(),
      type: "unused-package",
      severity: "low",
      title: `Unused dependency: ${pkg}`,
      detail: `Package is declared in ${profile.manifest?.path ?? "the manifest"} but no import was found in the source files analyzed.`,
      files: [profile.manifest?.path ?? ""],
      checkedFor: [
        `declared deps in ${profile.manifest?.path ?? "manifest"}`,
        "import/require usage across sampled + usage sources",
      ],
      foundEvidence: `No import of "${pkg}" found in analyzed sources.`,
    });
  }

  const oversized = findOversizedFiles(tree, profile).slice(0, 5);
  for (const f of oversized) {
    const node = tree.find((n) => n.path === f);
    const kb = node?.size ? `${(node.size / 1000).toFixed(1)} KB` : "";
    findings.push({
      id: id(),
      type: "oversized-file",
      severity: "medium",
      title: `Oversized file${kb ? ` (${kb})` : ""}`,
      detail:
        "Files over ~300 lines are hard to navigate and often violate single-responsibility. Consider splitting.",
      files: [f],
      checkedFor: ["file size vs ~15 KB oversized threshold"],
      foundEvidence: kb ? `${f} is ${kb}.` : `${f} exceeds the oversized threshold.`,
    });
  }

  const sepIssues = profile.id === "node" ? checkSeparation(files).slice(0, 4) : [];
  for (const f of sepIssues) {
    findings.push({
      id: id(),
      type: "separation-issue",
      severity: "high",
      title: "Database access in client layer",
      detail:
        "A route or component imports a DB client directly. Move DB access to a server-only service layer.",
      files: [f],
      checkedFor: ["direct DB client imports in route/component files"],
      foundEvidence: `${f} imports a database client in a client-facing layer.`,
    });
  }

  const duplicates =
    profile.duplicateLogicMatters === false
      ? []
      : findDuplicateLogic(files, profile, ctx).slice(0, 3);
  for (const group of duplicates) {
    findings.push({
      id: id(),
      type: "duplicate-logic",
      severity: "medium",
      title: "Possible duplicated logic",
      detail:
        "These files share the same external import fingerprint. Review for copy-pasted logic that should be extracted.",
      files: group,
      checkedFor: ["external import fingerprints across sampled files"],
      foundEvidence: `Matching fingerprint across: ${group.join(", ")}.`,
    });
  }

  const score = calcArchScore(findings);
  return { score, findings, scannedFiles: Object.keys(files).length };
}
