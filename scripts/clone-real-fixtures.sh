#!/usr/bin/env bash
# Shallow-clone the real upstream repos used by the fix-tool Docker harness.
set -euo pipefail
ROOT="${LR_FIXTURES_DIR:-$(cd "$(dirname "$0")/.." && pwd)/.scratch/real-fixtures}"
mkdir -p "$ROOT"

clone() {
  local name="$1" url="$2"
  local dest="$ROOT/$name"
  if [[ -f "$dest/package.json" || -f "$dest/go.mod" || -f "$dest/Cargo.toml" || -f "$dest/pom.xml" || -f "$dest/build.gradle" || -f "$dest/build.gradle.kts" || -f "$dest/requirements.txt" || -f "$dest/pyproject.toml" || -f "$dest/Gemfile" || -f "$dest/composer.json" || -f "$dest/mix.exs" || -f "$dest"/*.csproj || -f "$dest"/*/*.csproj || -f "$dest"/*/*.sln ]]; then
    echo "[skip] $name already populated"
    return 0
  fi
  rm -rf "$dest"
  echo "[clone] $name <- $url"
  git clone --depth 1 "$url" "$dest"
}

# Known mappings from scripts/verify-fix-tools.ts comments + readiness tests
#
# The five below were absent, which made 6 harness tests fail with ENOENT rather than a tool
# fault. Their upstreams were recorded only in docs/plans/fix-tool-accuracy-audit.md, deleted in
# 2a06887 — recover with `git show 2a06887^:docs/plans/fix-tool-accuracy-audit.md`. That doc's
# go-app/csharp-app/java-app entries match the lines below verbatim, which is what confirms it as
# the source. Each is pinned here so the mapping survives the next doc cleanup.
clone express-plain         https://github.com/heroku/node-js-getting-started
clone ruby-app              https://github.com/bbc/REST-API-example
clone rust-app              https://github.com/fairingrey/actix-realworld-example-app
clone php-app               https://github.com/slimphp/Slim-Skeleton
# The plan doc named this one descriptively ("auth0-developer-hub FastAPI hello-world") rather
# than by path. This repo is the match: it carries the pyproject.toml the harness comments
# mention and pins pydantic 1.10.2, the only major version where the recorded boot failure
# `pydantic.error_wrappers.ValidationError` exists (v2 moved it).
clone python-app            https://github.com/auth0-developer-hub/api_fastapi_python_hello-world

clone express-tsc           https://github.com/w3cj/express-api-starter-ts
clone depth-express         https://github.com/hagopj13/node-express-boilerplate
clone depth-python          https://github.com/miguelgrinberg/microblog
clone depth-ruby            https://github.com/gothinkster/rails-realworld-example-app
clone depth-csharp          https://github.com/davidfowl/TodoApi
clone depth-java            https://github.com/spring-projects/spring-petclinic
clone depth-php             https://github.com/symfony/demo
clone depth-rust            https://github.com/tokio-rs/mini-redis
clone echo-app              https://github.com/xesina/golang-echo-realworld-example-app
clone go-app                https://github.com/qiangxue/go-rest-api
clone csharp-app            https://github.com/FabianGosebrink/ASPNETCore-WebAPI-Sample
clone java-app              https://github.com/khoubyari/spring-boot-rest-example
clone kotlin-app            https://github.com/spring-petclinic/spring-petclinic-kotlin
clone elixir-app            https://github.com/dwyl/phoenix-chat-example
clone taxonomy              https://github.com/shadcn/taxonomy
clone mern-step             https://github.com/Brunno-DaSilva/MERN-STEP-BY-STEP
clone react-axios           https://github.com/bezkoder/react-axios-example
clone stripe-server         https://github.com/ruffrey/stripe-webhook-server
# Smaller Next app (not the next.js monorepo)
clone nextjs-app            https://github.com/vercel/nextjs-subscription-payments
# PHP Laravel skeleton
clone laravel-11            https://github.com/laravel/laravel
# FastAPI realworld
clone python-fastapi        https://github.com/nsidnev/fastapi-realworld-example-app

# t3-app is generated, not cloned — it is the official scaffold's *current* output, which is the
# point: it ships prisma/schema.prisma with no migrations dir, the should-fire ground truth for
# auditor-prisma-migrations. Absent, `auditors — real-repo detection accuracy` dies with ENOENT
# before asserting anything, so it belongs here rather than in a doc.
if [[ -f "$ROOT/t3-app/package.json" ]]; then
  echo "[skip] t3-app already populated"
else
  echo "[scaffold] t3-app <- create-t3-app"
  rm -rf "$ROOT/t3-app"
  (cd "$ROOT" && npx --yes create-t3-app@latest t3-app --CI --prisma --noGit --noInstall)
fi

echo "Fixtures root: $ROOT"
ls -1 "$ROOT"
