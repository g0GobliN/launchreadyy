/**
 * Docker cache plumbing for the real-execution audit in `scripts/verify-fix-tools.ts`.
 *
 * That harness runs every row in a container it then destroys, so without this module each of the
 * ~25 container rows re-downloads its entire dependency set from scratch — the same npm tree, the
 * same pip wheels, the same Gradle distribution — and each of the 12 `docker build` rows rebuilds
 * from an empty layer cache. Measured cold on one machine, a single `npm install` row took 179s
 * and the Next.js dependency tree blew a 19-minute cap. Almost all of that was network.
 *
 * Lives under `src/lib/` rather than next to the script for one reason: `vitest.config.ts` includes
 * only `src/**\/*.test.ts`, and these decisions fail *silently* when wrong. A cache volume mounted
 * one directory too high hides the compiler the image ships, and a family rule that stops matching
 * just means the rows quietly go back to downloading. `playwright-config.ts` is imported by the
 * root `playwright.config.ts` under the same precedent.
 *
 * Only *download* caches belong here. Build output (`node_modules`, `target/`, `deps/`) is per
 * fixture and per repo revision, so caching it would be a correctness hazard, not a speedup.
 */

export type ToolchainFamily =
  | "node"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "gradle"
  | "dotnet"
  | "elixir"
  | "php"
  | "ruby";

export interface CacheMount {
  /** Absolute path inside the container. */
  path: string;
  /** Named Docker volume. Created on first mount, which is also what triggers copy-up of
   * whatever the image already has at `path` — hence never pre-created. */
  volume: string;
}

export const CACHE_VOLUME_PREFIX = "lr-audit-cache";

/**
 * Where each toolchain keeps downloaded artifacts, and the volume that holds them.
 *
 * Every path is a *subdirectory* of the toolchain's home, never the home itself: mounting a volume
 * at `/usr/local/cargo` would hide `cargo`/`rustc`, at `/go` would hide `/go/bin`, at
 * `/root` would hide everything. The registry/cache subdirectories hold nothing but downloads.
 *
 * `/usr/local/bundle` is the one apparent exception — it is the Ruby image's declared VOLUME and
 * the gems live there, which is precisely why it is worth caching. A named volume is initialized
 * from the image's own content on first mount, so the preinstalled gems survive.
 */
export const TOOLCHAIN_CACHES: Record<ToolchainFamily, CacheMount[]> = {
  node: [
    { path: "/root/.npm", volume: `${CACHE_VOLUME_PREFIX}-npm` },
    { path: "/usr/local/share/.cache/yarn", volume: `${CACHE_VOLUME_PREFIX}-yarn` },
    { path: "/root/.cache/pnpm", volume: `${CACHE_VOLUME_PREFIX}-pnpm` },
  ],
  python: [
    { path: "/root/.cache/pip", volume: `${CACHE_VOLUME_PREFIX}-pip` },
    { path: "/root/.cache/uv", volume: `${CACHE_VOLUME_PREFIX}-uv` },
  ],
  go: [
    { path: "/go/pkg/mod", volume: `${CACHE_VOLUME_PREFIX}-go-mod` },
    { path: "/root/.cache/go-build", volume: `${CACHE_VOLUME_PREFIX}-go-build` },
  ],
  rust: [
    { path: "/usr/local/cargo/registry", volume: `${CACHE_VOLUME_PREFIX}-cargo-registry` },
    { path: "/usr/local/cargo/git", volume: `${CACHE_VOLUME_PREFIX}-cargo-git` },
  ],
  java: [{ path: "/root/.m2/repository", volume: `${CACHE_VOLUME_PREFIX}-m2` }],
  // Gradle is separate from Maven because the Kotlin and Java fixtures build through `./gradlew`:
  // the wrapper downloads a whole Gradle distribution on first use (~150MB), and the daemon's
  // dependency cache is what makes the second/third CI step fast.
  gradle: [{ path: "/root/.gradle", volume: `${CACHE_VOLUME_PREFIX}-gradle` }],
  dotnet: [{ path: "/root/.nuget/packages", volume: `${CACHE_VOLUME_PREFIX}-nuget` }],
  elixir: [
    { path: "/root/.hex", volume: `${CACHE_VOLUME_PREFIX}-hex` },
    { path: "/root/.mix", volume: `${CACHE_VOLUME_PREFIX}-mix` },
    { path: "/root/.cache/rebar3", volume: `${CACHE_VOLUME_PREFIX}-rebar3` },
  ],
  php: [
    { path: "/root/.cache/composer", volume: `${CACHE_VOLUME_PREFIX}-composer` },
    { path: "/root/.composer/cache", volume: `${CACHE_VOLUME_PREFIX}-composer-home` },
  ],
  ruby: [
    { path: "/usr/local/bundle", volume: `${CACHE_VOLUME_PREFIX}-bundle` },
    { path: "/root/.gem", volume: `${CACHE_VOLUME_PREFIX}-gem` },
  ],
};

/** Every cache volume this module can create, for inventory and reset. */
export function cacheVolumeNames(): string[] {
  const names = new Set<string>();
  for (const mounts of Object.values(TOOLCHAIN_CACHES)) {
    for (const mount of mounts) names.add(mount.volume);
  }
  return [...names].sort();
}

/**
 * The repository part of an image reference, tag and digest removed.
 *
 * Splitting on the *last* colon rather than the first is what keeps a registry with a port
 * (`registry.internal:5000/team/python:3.12`) from being read as tag `5000/team/python`.
 */
export function imageRepository(image: string): string {
  const noDigest = image.split("@")[0] ?? image;
  const lastSlash = noDigest.lastIndexOf("/");
  const lastColon = noDigest.lastIndexOf(":");
  const repo = lastColon > lastSlash ? noDigest.slice(0, lastColon) : noDigest;
  return repo.toLowerCase();
}

/**
 * Image repository → the toolchains whose caches a container based on it should share.
 *
 * Matched on the repository, not the reference, so a version bump (`node:20-slim` → `node:22`) or
 * a digest pin does not quietly stop the cache from applying.
 */
const FAMILY_RULES: Array<{ match: RegExp; families: ToolchainFamily[] }> = [
  { match: /(^|\/)(node|nodejs)$/, families: ["node"] },
  { match: /(^|\/)(python|python3)$/, families: ["python"] },
  // `golangci/golangci-lint` is the standalone linter image the Go rows run in; it is Go-based
  // and inherits GOPATH=/go, so it shares the module cache.
  { match: /(^|\/)(go|golang|golangci-lint)$/, families: ["go"] },
  { match: /(^|\/)rust$/, families: ["rust"] },
  // Both JDK images the suite uses are Gradle-driven for at least one fixture, so they get the
  // Maven *and* Gradle caches. `eclipse-temurin` matches the JDK images published under that name.
  { match: /(^|\/)(maven|gradle)$|eclipse-temurin/, families: ["java", "gradle"] },
  { match: /(^|\/)dotnet\/(sdk|aspnet|runtime)$/, families: ["dotnet"] },
  { match: /(^|\/)elixir$/, families: ["elixir"] },
  { match: /(^|\/)(composer|php)$/, families: ["php"] },
  { match: /(^|\/)ruby$/, families: ["ruby"] },
];

/** Toolchains to cache for a container image. Empty for images with nothing worth keeping
 * (`alpine`, `nginx`) — those are also how `cleanupWorkDir` runs, where a cache would be waste. */
export function familiesForImage(image: string): ToolchainFamily[] {
  const repo = imageRepository(image);
  const out = new Set<ToolchainFamily>();
  for (const rule of FAMILY_RULES) {
    if (!rule.match.test(repo)) continue;
    for (const family of rule.families) out.add(family);
  }
  return [...out];
}

/**
 * Deduplicated mounts across several images.
 *
 * A row can pass more than one image (a CI job's `uses:` steps pull their own), and two images from
 * the same family must not produce the same `-v` twice — Docker rejects a repeated mount path
 * inside one container.
 */
export function cacheMountsForImages(images: Iterable<string>): CacheMount[] {
  const out: CacheMount[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    for (const family of familiesForImage(image)) {
      for (const mount of TOOLCHAIN_CACHES[family]) {
        if (seen.has(mount.path)) continue;
        seen.add(mount.path);
        out.push(mount);
      }
    }
  }
  return out;
}

/** `docker run`/`create` arguments binding every applicable cache volume. */
export function cacheMountArgs(images: Iterable<string>): string[] {
  return cacheMountsForImages(images).flatMap((mount) => ["-v", `${mount.volume}:${mount.path}`]);
}

/**
 * Docker's human-readable size strings (`0B`, `48.98MB`, `1.313GB`).
 *
 * Docker emits decimal units and Docker Desktop's disk usage is decimal, so `MB`/`GB` scale by
 * 1000 while the explicit `MiB`/`GiB` forms scale by 1024.
 */
export function parseDockerSize(text: string): number {
  const match = /^\s*([\d.]+)\s*([kmgt]?i?b)\s*$/i.exec(text ?? "");
  if (!match) return 0;
  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) return 0;
  const scale: Record<string, number> = {
    b: 1,
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
  };
  return Math.round(value * (scale[(match[2] ?? "b").toLowerCase()] ?? 1));
}

/** Human-readable bytes, for the one-line cache report. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)}kB`;
  return `${bytes}B`;
}

/**
 * How much of the dependency cache is already on disk, restricted to volumes this module owns.
 *
 * A count alone would be misleading — an empty volume per language reads the same as a full one,
 * and "12 volumes" with nothing in them is exactly the cold case the report exists to distinguish.
 */
export function summarizeCacheVolumes(volumes: Array<{ name: string; size: string }>): {
  count: number;
  bytes: number;
} {
  const known = new Set(cacheVolumeNames());
  const mine = volumes.filter((volume) => known.has(volume.name));
  return {
    count: mine.length,
    bytes: mine.reduce((total, volume) => total + parseDockerSize(volume.size), 0),
  };
}

export interface PullOutcome {
  image: string;
  ok: boolean;
  /** One line naming the reason, not the daemon's whole transcript. */
  detail: string;
}

/** The line worth showing out of a `docker pull` transcript: the failure, if there was one. */
export function summarizePullOutput(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const failure = lines.find((line) =>
    /error|denied|not found|unauthorized|no such|timeout|timed out/i.test(line),
  );
  return failure ?? lines[lines.length - 1] ?? "";
}

/**
 * Pull every image at once and report each outcome.
 *
 * The `pull` function is injected rather than called directly so the orchestration — which is where
 * the bugs would live — is unit-testable without a daemon: a rejection that discards the other
 * twelve results, or a partial failure reported as a total one, would both do real damage here,
 * because the caller decides from these outcomes whether to warn or stay quiet.
 */
export async function pullImagesInParallel(
  images: readonly string[],
  pull: (image: string) => Promise<{ ok: boolean; stdout: string; stderr: string }>,
): Promise<PullOutcome[]> {
  return Promise.all(
    images.map(async (image): Promise<PullOutcome> => {
      try {
        const res = await pull(image);
        return { image, ok: res.ok, detail: summarizePullOutput(`${res.stdout}\n${res.stderr}`) };
      } catch (err) {
        // A throw from one pull must not discard the report for the rest.
        return { image, ok: false, detail: (err as Error).message };
      }
    }),
  );
}

/**
 * Whether `docker build` imports the harness's on-disk layer cache, exports to it, or ignores it.
 *
 * The daemon already keeps a layer cache, and on this suite that is what makes a repeat
 * `docker build` fast — the generated Dockerfile is byte-identical and the context is unchanged,
 * so `npm ci`/`pip install`/`gradle build` layers hit. The problem is that `docker builder prune`
 * (or a daemon reset, or CI's fresh VM) discards it silently, and the cost of finding out is
 * another hour. Exporting the cache to a directory under `.scratch/` makes it survive that.
 *
 * Export is opt-in because `type=local` writes the *whole* cache after every build, and there are
 * 12 build rows: paying it on every run to protect against an occasional prune is a bad trade.
 * Import is free and happens by default, so `LR_AUDIT_BUILD_CACHE=read-write npm run verify:tools`
 * once is enough to create the durable cache for all later runs.
 */
export type BuildCacheMode = "off" | "read" | "read-write";

export function parseBuildCacheMode(raw: string | undefined): BuildCacheMode {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "off":
    case "0":
    case "false":
    case "none":
      return "off";
    case "write":
    case "read-write":
    case "rw":
      return "read-write";
    default:
      // Includes an explicit "read"/"on"/"1"/"true" and anything unrecognized: importing a cache
      // that may not exist is harmless, whereas silently not using one costs an hour.
      return "read";
  }
}

/** `buildx build` cache flags. Returns `[]` when there is nothing to import yet. */
export function buildCacheArgs(mode: BuildCacheMode, dir: string, dirExists: boolean): string[] {
  if (mode === "off") return [];
  const write = ["--cache-to", `type=local,dest=${dir},mode=max`];
  if (!dirExists) return mode === "read-write" ? [...write] : [];
  const args = ["--cache-from", `type=local,src=${dir}`];
  if (mode === "read-write") args.push(...write);
  return args;
}

/**
 * The build command, given whether `buildx` answered.
 *
 * `buildx build --load` rather than plain `docker build` only because cache import/export needs the
 * explicit plugin invocation; on Docker 23+ `docker build` is buildx anyway, so the build itself
 * sees the same executor and the audit keeps grading the same artifact. `--load` is what puts the
 * resulting image into the local image store for the `docker run` that follows.
 */
export function buildCommandArgs(
  buildxAvailable: boolean,
  cacheArgs: string[],
  tag: string,
  context: string,
): string[] {
  return buildxAvailable
    ? ["buildx", "build", "--load", "-t", tag, ...cacheArgs, context]
    : ["build", "-t", tag, context];
}
