export function rustBinaryName(cargoToml: string): string {
  const binNames = [...cargoToml.matchAll(/\[\[bin\]\]([\s\S]*?)(?=\n\[|$)/g)]
    .map((m) => m[1]!.match(/name\s*=\s*"([^"]+)"/)?.[1])
    .filter((n): n is string => Boolean(n));
  const serverish = binNames.find((n) => /server|serve|api|web|daemon|app/i.test(n));
  if (serverish) return serverish;
  if (binNames[0]) return binNames[0];
  const pkgSection = cargoToml.match(/\[package\]([\s\S]*?)(?=\n\[|$)/);
  const pkgName = pkgSection?.[1].match(/name\s*=\s*"([^"]+)"/);
  return pkgName?.[1] ?? "server";
}

export function dockerfileRust(cargoToml: string, filePaths: string[] = []): string {
  const bin = rustBinaryName(cargoToml);
  // The dependency-caching trick must create a dummy for EVERY compile target Cargo.toml
  // declares, not just src/main.rs — confirmed against the real tokio-rs/mini-redis: its
  // explicit [[bin]] path entries (src/bin/cli.rs, src/bin/server.rs) made the dummy-main-only
  // build fail outright ("couldn't read src/bin/cli.rs"). A dummy src/lib.rs is needed too when
  // the real crate has one (bins are allowed to be lib consumers). All dummies are wiped before
  // the real COPY so nothing stray survives into the actual build.
  const binPaths = [...cargoToml.matchAll(/\[\[bin\]\]([\s\S]*?)(?=\n\[|$)/g)]
    .map((m) => m[1]!.match(/path\s*=\s*"([^"]+)"/)?.[1])
    .filter((p): p is string => Boolean(p));
  const dummyBins = binPaths.length > 0 ? binPaths : ["src/main.rs"];
  const dummyCmds = [
    ...(filePaths.includes("src/lib.rs") ? ["mkdir -p src && echo '' > src/lib.rs"] : []),
    ...dummyBins.map((p) => {
      const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
      return `mkdir -p ${dir} && echo 'fn main(){}' > ${p}`;
    }),
  ].join(" && ");
  return `FROM rust:1.78-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN ${dummyCmds} && cargo build --release && rm -rf src
COPY . .
RUN find src -name '*.rs' -exec touch {} + && cargo build --release

FROM alpine:3.20 AS runner
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
COPY --from=build /app/target/release/${bin} ./server
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["./server"]
`;
}
