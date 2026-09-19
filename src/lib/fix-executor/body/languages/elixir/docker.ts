export const DOCKERFILE_ELIXIR = `FROM elixir:1.16-alpine AS build
RUN apk add --no-cache build-base git
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
COPY . .
RUN mix compile
RUN mix release
RUN sed -i 's/\r$//' _build/prod/rel/*/bin/* 2>/dev/null || true

FROM alpine:3.20 AS runner
RUN apk add --no-cache ncurses-libs libstdc++ openssl ca-certificates wget
WORKDIR /app
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
COPY --from=build /app/_build/prod/rel/*/. ./
USER app
EXPOSE 4000
ENV PHX_SERVER=true
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:4000/health || exit 1
# bin/server is the rel/overlays script \`mix phx.gen.release\` commits into the repo; a plain
# \`mix release\` produces only bin/<app_name>. Hardcoding bin/server made the container exit
# immediately on a release that has no overlay.
#
# Run it through \`sh\` rather than exec'ing it directly. Being a committed file, the overlay
# carries whatever line endings the author's checkout used — a Windows CRLF copy makes the kernel
# read its shebang as "/bin/sh\\r", which it cannot find, so the container dies with the very
# confusing "bin/server: not found" for a file that plainly exists and is executable. Confirmed on
# a real Phoenix fixture. bin/<app_name> is generated at build time, so it is always LF.
CMD ["sh", "-c", "if [ -f bin/server ]; then exec sh bin/server; else exec \\"$(find bin -maxdepth 1 -type f ! -name '*.bat' | head -1)\\" start; fi"]
`;
