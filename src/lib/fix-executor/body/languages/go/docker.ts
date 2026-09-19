export function goMainPackageDir(filePaths: string[]): string {
  const cmdMain = filePaths.find((p) => /^cmd\/[^/]+\/main\.go$/.test(p));
  if (cmdMain) return `./${cmdMain.replace(/\/main\.go$/, "")}`;
  if (filePaths.includes("main.go")) return ".";
  return "./cmd/server";
}

export function dockerfileGo(filePaths: string[]): string {
  const mainDir = goMainPackageDir(filePaths);
  // Confirmed against a real repo: the runner stage previously copied only the compiled binary,
  // nothing else — any app that reads runtime assets off disk (config/*.yml is the dominant Go
  // convention, since go:embed didn't exist pre-1.16 and many repos still don't use it) crashed
  // on boot with a missing-file error despite `docker build` succeeding.
  const runtimeDirs = ["config", "migrations", "templates"].filter((d) =>
    filePaths.some((p) => p.startsWith(`${d}/`)),
  );
  const copyRuntimeDirs = runtimeDirs.map((d) => `COPY --from=build /app/${d} ./${d}\n`).join("");
  return `FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o server ${mainDir} 2>/dev/null || go build -trimpath -o server .

FROM alpine:3.20 AS runner
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
COPY --from=build /app/server ./server
${copyRuntimeDirs}USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["./server"]
`;
}
