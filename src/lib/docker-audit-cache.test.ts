import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CACHE_VOLUME_PREFIX,
  TOOLCHAIN_CACHES,
  buildCacheArgs,
  buildCommandArgs,
  cacheMountArgs,
  cacheMountsForImages,
  cacheVolumeNames,
  familiesForImage,
  formatBytes,
  imageRepository,
  parseBuildCacheMode,
  parseDockerSize,
  pullImagesInParallel,
  summarizeCacheVolumes,
  summarizePullOutput,
  type ToolchainFamily,
} from "./docker-audit-cache";

describe("imageRepository", () => {
  it("strips the tag", () => {
    expect(imageRepository("node:20-slim")).toBe("node");
    expect(imageRepository("mcr.microsoft.com/dotnet/sdk:8.0")).toBe(
      "mcr.microsoft.com/dotnet/sdk",
    );
    expect(imageRepository("golangci/golangci-lint:latest")).toBe("golangci/golangci-lint");
  });

  it("does not read a registry port as the tag", () => {
    // Splitting on the first colon yields `registry.internal:5000/team/python`, which matches no
    // family rule — the cache would silently stop applying for every privately-hosted image.
    expect(imageRepository("registry.internal:5000/team/python:3.12")).toBe(
      "registry.internal:5000/team/python",
    );
    expect(familiesForImage("registry.internal:5000/team/python:3.12")).toEqual(["python"]);
  });

  it("strips a digest pin", () => {
    expect(imageRepository("node@sha256:0123456789abcdef")).toBe("node");
    expect(familiesForImage("node@sha256:0123456789abcdef")).toEqual(["node"]);
  });

  it("is case-insensitive and leaves an untagged repo alone", () => {
    expect(imageRepository("Node:20-Slim")).toBe("node");
    expect(imageRepository("ruby")).toBe("ruby");
  });
});

describe("familiesForImage", () => {
  it("recognizes every toolchain image the audit uses", () => {
    const expected: Array<[image: string, families: ToolchainFamily[]]> = [
      ["node:20-slim", ["node"]],
      ["node:20-bookworm-slim", ["node"]],
      ["python:3.12-slim", ["python"]],
      ["golang:1.22", ["go"]],
      ["golangci/golangci-lint:latest", ["go"]],
      ["rust:1.78", ["rust"]],
      ["maven:3.9-eclipse-temurin-21-alpine", ["java", "gradle"]],
      ["maven:3.9-eclipse-temurin-17-alpine", ["java", "gradle"]],
      ["eclipse-temurin:21-jdk", ["java", "gradle"]],
      ["composer:2", ["php"]],
      ["php:8.2-cli", ["php"]],
      ["ruby:3.3", ["ruby"]],
      ["elixir:1.16-alpine", ["elixir"]],
      ["mcr.microsoft.com/dotnet/sdk:8.0", ["dotnet"]],
      ["mcr.microsoft.com/dotnet/aspnet:8.0", ["dotnet"]],
      ["mcr.microsoft.com/dotnet/runtime:8.0", ["dotnet"]],
    ];
    for (const [image, families] of expected) {
      expect(familiesForImage(image), image).toEqual(families);
    }
  });

  it("gives nothing to images with nothing to keep", () => {
    // `alpine` is how cleanupWorkDir runs a throwaway chown container — attaching a cache volume
    // there would only create volumes nobody reads.
    expect(familiesForImage("alpine:latest")).toEqual([]);
    expect(familiesForImage("alpine:3.20")).toEqual([]);
    expect(familiesForImage("nginx:alpine")).toEqual([]);
  });

  it("does not match a repository that merely contains a toolchain name", () => {
    expect(familiesForImage("myorg/node-exporter:1")).toEqual([]);
    expect(familiesForImage("docker/compose:2")).toEqual([]);
  });
});

describe("cache mount safety", () => {
  const allMounts = Object.entries(TOOLCHAIN_CACHES).flatMap(([family, mounts]) =>
    mounts.map((mount) => ({ family, ...mount })),
  );

  it("never mounts over a toolchain home or a system bin directory", () => {
    // This is the failure this file exists to prevent, and it is silent-then-fatal: mounting a
    // volume at `/usr/local/cargo` hides cargo/rustc, at `/go` hides /go/bin, at `/root` hides
    // everything. The row then fails with "cargo: not found" and looks like a product bug.
    const forbidden = new Set([
      "/",
      "/root",
      "/usr",
      "/usr/local",
      "/usr/bin",
      "/usr/local/bin",
      "/bin",
      "/go",
      "/usr/local/go",
      "/usr/local/cargo",
      "/usr/local/bundle/..",
    ]);
    for (const mount of allMounts) {
      expect(forbidden.has(mount.path), `${mount.family} mounts ${mount.path}`).toBe(false);
      expect(mount.path.startsWith("/"), mount.path).toBe(true);
      // Two segments minimum: `/x` is always a directory worth not shadowing by accident.
      expect(mount.path.split("/").filter(Boolean).length, mount.path).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the download caches, not the compilers", () => {
    expect(TOOLCHAIN_CACHES.rust.map((m) => m.path)).toEqual([
      "/usr/local/cargo/registry",
      "/usr/local/cargo/git",
    ]);
    expect(TOOLCHAIN_CACHES.go.map((m) => m.path)).toContain("/go/pkg/mod");
    // Gems live in the Ruby image's declared VOLUME; caching it is the point, and a named volume
    // is initialized from the image's own content on first mount, so preinstalled gems survive.
    expect(TOOLCHAIN_CACHES.ruby.map((m) => m.path)).toContain("/usr/local/bundle");
  });

  it("uses unique, legal, prefixed volume names", () => {
    const names = allMounts.map((m) => m.volume);
    expect(new Set(names).size, "volume names must be unique").toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
      expect(name.startsWith(`${CACHE_VOLUME_PREFIX}-`)).toBe(true);
    }
    expect(cacheVolumeNames()).toEqual([...names].sort());
  });

  it("mounts each path only once even when several images are passed", () => {
    const mounts = cacheMountsForImages(["node:20-slim", "node:20-bookworm-slim", "node:22"]);
    const paths = mounts.map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(["/root/.npm", "/usr/local/share/.cache/yarn", "/root/.cache/pnpm"]);

    // Docker rejects the same mount path twice inside one container.
    const args = cacheMountArgs(["node:20-slim", "node:20-bookworm-slim"]);
    expect(args.filter((a) => a === "-v")).toHaveLength(3);
    expect(args).toContain("-v");
    expect(args).toContain(`${CACHE_VOLUME_PREFIX}-npm:/root/.npm`);
  });

  it("returns nothing for an image set with no caches", () => {
    expect(cacheMountArgs(["alpine:latest"])).toEqual([]);
  });
});

describe("coverage of the images the audit actually names", () => {
  /**
   * Read the audit script's own image literals back out of its source.
   *
   * A family rule that stops matching does not fail loudly — the row simply starts re-downloading
   * its dependency tree, which looks like a slow machine. Pinning the coverage against the script
   * itself means adding a fixture image without a cache family fails here instead.
   */
  const source = readFileSync(
    new URL("../../scripts/verify-fix-tools.ts", import.meta.url),
    "utf8",
  );
  const normalized = source.replace(/\$\{[^}]*\}/g, "X");

  const literals = new Set<string>();
  for (const match of normalized.matchAll(/["'`]([^"'`\n]+)["'`]/g)) {
    const value = match[1] ?? "";
    if (!/^[a-z0-9][\w.-]*(\/[\w.-]+)*:[\w.X-]+$/i.test(value)) continue;
    // A `${a}:${b}` pair (e.g. `getuid():getgid()`) normalizes to a placeholder repository and
    // names no image — the image name itself was interpolated, so there is nothing to check.
    if (/^x+$/i.test(imageRepository(value))) continue;
    literals.add(value);
  }

  it("extracts a meaningful set of literals", () => {
    // Guards the extractor itself: a regex that matched nothing would make the check below pass
    // vacuously, which is the exact failure mode being pinned.
    expect(literals.size).toBeGreaterThan(8);
    for (const known of [
      "python:3.12-slim",
      "golang:1.22",
      "ruby:3.3",
      "rust:1.78",
      "composer:2",
      "elixir:1.16-alpine",
      "node:20-slim",
      "golangci/golangci-lint:latest",
    ]) {
      expect(literals, known).toContain(known);
    }
  });

  it("either caches or deliberately excludes every image literal", () => {
    // Images with nothing to download: `alpine` runs cleanupWorkDir's chown/rm, `debian` is the
    // Rust generator's empty runtime stage, and `nginx` serves static files it did not fetch.
    const deliberatelyUncacheable = new Set([
      "alpine:latest",
      "alpine:3.20",
      "debian:bookworm-slim",
      "nginx:alpine",
    ]);
    const uncached = [...literals].filter(
      (image) => familiesForImage(image).length === 0 && !deliberatelyUncacheable.has(image),
    );
    expect(uncached, "images with no cache family — add a rule or exclude them here").toEqual([]);
  });
});

describe("cache reporting", () => {
  it("reads Docker's size strings", () => {
    expect(parseDockerSize("0B")).toBe(0);
    expect(parseDockerSize("48.98MB")).toBe(48_980_000);
    expect(parseDockerSize("1.313GB")).toBe(1_313_000_000);
    expect(parseDockerSize("512kB")).toBe(512_000);
    expect(parseDockerSize("2GiB")).toBe(2 * 1024 ** 3);
    // Anything unparseable counts as nothing rather than NaN, which would poison the total and
    // print as "NaNB".
    expect(parseDockerSize("N/A")).toBe(0);
    expect(parseDockerSize("")).toBe(0);
  });

  it("formats bytes for the report", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(999)).toBe("999B");
    expect(formatBytes(1_313_000_000)).toBe("1.3GB");
    expect(formatBytes(48_980_000)).toBe("49.0MB");
  });

  it("counts only this module's volumes, and only for their bytes", () => {
    // An unrelated volume must not be reported as part of the audit's cache; a volume of ours that
    // exists but is empty must be counted at 0B, because "12 volumes" with nothing in them is the
    // cold case the report exists to distinguish from a warm one.
    const volumes = [
      { name: `lr-audit-cache-npm`, size: "120.5MB" },
      { name: `lr-audit-cache-m2`, size: "1.2GB" },
      { name: "test_db-data", size: "48.98MB" },
      { name: `lr-audit-cache-probe`, size: "999MB" },
    ];
    expect(summarizeCacheVolumes(volumes)).toEqual({ count: 2, bytes: 1_320_500_000 });
    expect(summarizeCacheVolumes([])).toEqual({ count: 0, bytes: 0 });
  });
});

describe("summarizePullOutput", () => {
  it("finds the failure rather than the last progress line", () => {
    // `docker pull` prints progress last on success but interleaves it on failure, so a plain
    // tail -1 would report "Pulling fs layer" for a completely failed pull.
    expect(
      summarizePullOutput(
        [
          "abc: Pulling from library/node",
          "error pulling image configuration: denied: requested access to the resource is denied",
          "Pulling fs layer",
        ].join("\n"),
      ),
    ).toMatch(/denied/);
    expect(summarizePullOutput("Status: Downloaded newer image for node:20-slim")).toBe(
      "Status: Downloaded newer image for node:20-slim",
    );
    expect(summarizePullOutput("\n\n")).toBe("");
  });
});

describe("pullImagesInParallel", () => {
  it("pulls everything concurrently and reports each outcome", async () => {
    const started: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const outcomes = await pullImagesInParallel(
      ["node:20-slim", "python:3.12-slim", "ruby:3.3"],
      async (image) => {
        started.push(image);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return {
          ok: image !== "ruby:3.3",
          stdout: "",
          stderr: image === "ruby:3.3" ? "manifest unknown" : "",
        };
      },
    );
    // Concurrency is the whole point: serially, a first run pays for each image in turn.
    expect(peak).toBe(3);
    expect(started).toEqual(["node:20-slim", "python:3.12-slim", "ruby:3.3"]);
    expect(outcomes).toEqual([
      { image: "node:20-slim", ok: true, detail: "" },
      { image: "python:3.12-slim", ok: true, detail: "" },
      { image: "ruby:3.3", ok: false, detail: "manifest unknown" },
    ]);
  });

  it("keeps the other results when one pull throws", async () => {
    // The whole point of reporting per image: a single rejected pull (a network error, a daemon
    // hiccup) must not lose the outcomes for the images that succeeded.
    const outcomes = await pullImagesInParallel(["a:1", "b:2"], async (image) => {
      if (image === "a:1") throw new Error("socket hang up");
      return { ok: true, stdout: "done", stderr: "" };
    });
    expect(outcomes).toEqual([
      { image: "a:1", ok: false, detail: "socket hang up" },
      { image: "b:2", ok: true, detail: "done" },
    ]);
  });

  it("handles an empty image list", async () => {
    expect(
      await pullImagesInParallel([], async () => ({ ok: true, stdout: "", stderr: "" })),
    ).toEqual([]);
  });
});

describe("parseBuildCacheMode", () => {
  it("defaults to importing the cache", () => {
    // The safe default: importing a cache that may not exist is harmless, whereas silently not
    // using one costs the hour this module exists to save.
    expect(parseBuildCacheMode(undefined)).toBe("read");
    expect(parseBuildCacheMode("")).toBe("read");
    expect(parseBuildCacheMode("read")).toBe("read");
    expect(parseBuildCacheMode("on")).toBe("read");
    expect(parseBuildCacheMode("nonsense")).toBe("read");
  });

  it("recognizes the opt-outs and the export opt-in", () => {
    for (const off of ["off", "0", "false", "none", " OFF "]) {
      expect(parseBuildCacheMode(off), off).toBe("off");
    }
    for (const write of ["write", "read-write", "rw"]) {
      expect(parseBuildCacheMode(write), write).toBe("read-write");
    }
  });
});

describe("buildCacheArgs", () => {
  const dir = "/repo/.scratch/docker-build-cache";

  it("returns nothing when caching is off", () => {
    expect(buildCacheArgs("off", dir, true)).toEqual([]);
    expect(buildCacheArgs("off", dir, false)).toEqual([]);
  });

  it("imports an existing cache without exporting it", () => {
    expect(buildCacheArgs("read", dir, true)).toEqual(["--cache-from", `type=local,src=${dir}`]);
  });

  it("skips the import when the cache directory is not there yet", () => {
    // A missing src is only a warning to buildx, but emitting neither flag keeps the build log
    // free of a line that reads like a misconfiguration on every first run.
    expect(buildCacheArgs("read", dir, false)).toEqual([]);
  });

  it("exports with mode=max only when asked", () => {
    // mode=max, not min: the layers worth keeping are the intermediate `npm ci`/`pip install`
    // ones, which a final-image-only export discards.
    expect(buildCacheArgs("read-write", dir, true)).toEqual([
      "--cache-from",
      `type=local,src=${dir}`,
      "--cache-to",
      `type=local,dest=${dir},mode=max`,
    ]);
    expect(buildCacheArgs("read-write", dir, false)).toEqual([
      "--cache-to",
      `type=local,dest=${dir},mode=max`,
    ]);
  });
});

describe("buildCommandArgs", () => {
  it("uses buildx with --load so the image is available to docker run", () => {
    expect(buildCommandArgs(true, ["--cache-from", "type=local,src=/c"], "tag", ".")).toEqual([
      "buildx",
      "build",
      "--load",
      "-t",
      "tag",
      "--cache-from",
      "type=local,src=/c",
      ".",
    ]);
  });

  it("falls back to plain docker build when buildx is absent", () => {
    // An older daemon without the plugin must still run the audit; it just cannot import a cache.
    expect(buildCommandArgs(false, ["--cache-from", "type=local,src=/c"], "tag", ".")).toEqual([
      "build",
      "-t",
      "tag",
      ".",
    ]);
  });
});
