import { Template } from "e2b";

/**
 * LaunchReadyy deep-tier sandbox image.
 *
 * Whole-repo secret sweep, plus polyglot install/build/test toolchains.
 * Node and Python come from e2bdev/base. Extra SDKs install into $HOME — the E2B
 * builder is not root, so /usr/local writes fail (seen: tar Permission denied).
 *
 * Build: `npm run e2b:build:prod` from repo root (see launchreadyy/README.md).
 * Set E2B_TEMPLATE_ID to the built template id in .env.
 */
export const template = Template()
  .fromImage("e2bdev/base")
  // Installed *without* a `|| true` fallback, and verified on the next line. An analyzer missing
  // from the image produces scans that silently find nothing, and the failure then surfaces as a
  // clean bill of health for the user's repo — the worst possible place to discover it. Fail here,
  // at build time, where an operator is watching.
  //
  // Semgrep was removed from this image on 2026-08-18: its registry rule packs may not be offered
  // as a service (docs/reference/19-tool-licensing.md). Analyzers added here must be permissively
  // licensed — osv-scanner, trivy, gitleaks and zizmor are cleared.
  .runCmd("pip install --break-system-packages poetry ruff || pip3 install --user poetry ruff")
  .runCmd("poetry --version")
  .runCmd("ruff --version")
  // Native build deps for Ruby gems (pg) + Laravel PHP extensions.
  .runCmd(
    [
      "set -e",
      "sudo apt-get update -qq",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential libpq-dev libyaml-dev zlib1g-dev php-cli php-xml php-mbstring php-curl php-zip php-intl php-sqlite3 php-mysql php-gd unzip",
      "php -v",
      'mkdir -p "$HOME/.local/bin"',
      'curl -fsSL https://getcomposer.org/installer | php -- --install-dir="$HOME/.local/bin" --filename=composer',
      "composer --version",
    ].join(" && "),
  )
  // Bump Node past base 20.9 — engines often require ≥20.19 / 22.x.
  .runCmd(
    [
      "set -e",
      "NODE_V=22.14.0",
      'mkdir -p "$HOME/.local/node"',
      'curl -fsSL "https://nodejs.org/dist/v${NODE_V}/node-v${NODE_V}-linux-x64.tar.gz" | tar -xz -C "$HOME/.local/node" --strip-components=1',
      'mkdir -p "$HOME/.local/bin"',
      'ln -sf "$HOME/.local/node/bin/node" "$HOME/.local/bin/node"',
      'ln -sf "$HOME/.local/node/bin/npm" "$HOME/.local/bin/npm"',
      'ln -sf "$HOME/.local/node/bin/npx" "$HOME/.local/bin/npx"',
      'ln -sf "$HOME/.local/node/bin/corepack" "$HOME/.local/bin/corepack"',
      'export PATH="$HOME/.local/bin:$PATH"',
      "node -v",
      "npm -v",
      "corepack enable",
      "corepack prepare pnpm@9.15.0 --activate",
      "pnpm -v",
      "curl -fsSL https://bun.sh/install | bash",
      'ln -sf "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun"',
      "bun -v",
    ].join(" && "),
  )
  // Go → $HOME/go (not /usr/local — builder is non-root).
  .runCmd(
    [
      "set -e",
      'curl -fsSL https://go.dev/dl/go1.22.10.linux-amd64.tar.gz | tar -C "$HOME" -xz',
      'mkdir -p "$HOME/.local/bin"',
      'ln -sf "$HOME/go/bin/go" "$HOME/.local/bin/go"',
      'ln -sf "$HOME/go/bin/gofmt" "$HOME/.local/bin/gofmt"',
      'export PATH="$HOME/go/bin:$HOME/.local/bin:$PATH"',
      "go version",
      'grep -q \'HOME/go/bin\' "$HOME/.bashrc" 2>/dev/null || echo \'export PATH="$HOME/.local/bin:$HOME/go/bin:$HOME/.cargo/bin:$HOME/.local/share/mise/shims:$HOME/.dotnet:$HOME/.dotnet/tools:$HOME/.bun/bin:$PATH"\' >> "$HOME/.bashrc"',
      'grep -q DOTNET_ROOT "$HOME/.bashrc" 2>/dev/null || echo \'export DOTNET_ROOT="$HOME/.dotnet"\' >> "$HOME/.bashrc"',
    ].join(" && "),
  )
  // Rust via rustup (user-space) + wasm-pack (needed when a repo's build compiles a WASM crate;
  // LaunchReadyy's own `npm run build` runs ensure-wasm.mjs → wasm-pack).
  .runCmd(
    [
      "set -e",
      'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable -c rustfmt',
      '. "$HOME/.cargo/env"',
      "rustup target add wasm32-unknown-unknown",
      // Prebuilt binary — `cargo install wasm-pack` is fragile on some hosts (see rust/README.md).
      "curl -fsSL https://github.com/wasm-bindgen/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz | tar -xz -C /tmp",
      'mkdir -p "$HOME/.local/bin"',
      'install -m 755 /tmp/wasm-pack-v0.13.1-x86_64-unknown-linux-musl/wasm-pack "$HOME/.local/bin/wasm-pack"',
      'ln -sf "$HOME/.cargo/bin/cargo" "$HOME/.local/bin/cargo"',
      'ln -sf "$HOME/.cargo/bin/rustc" "$HOME/.local/bin/rustc"',
      "rustc --version",
      "cargo --version",
      "wasm-pack --version",
    ].join(" && "),
  )
  // mise — prebuilt Java/Maven/Gradle/Ruby; Erlang then Elixir (elixir alone has no erl).
  .runCmd(
    [
      "set -e",
      'curl -fsSL https://mise.run | MISE_INSTALL_PATH="$HOME/.local/bin/mise" sh',
      'export PATH="$HOME/.local/bin:$PATH"',
      "mise --version",
      "mise use -g java@21 maven@3.9 gradle@8 ruby@3.3 erlang@27 elixir@1.17",
      'export PATH="$HOME/.local/share/mise/shims:$PATH"',
      "java -version",
      "mvn -version",
      "gradle -version",
      "ruby -v",
      "erl -eval 'halt().' -noshell",
      "elixir --version",
      "gem install bundler --no-document",
      "bundle -v",
    ].join(" && "),
  )
  // .NET SDK → $HOME/.dotnet (official non-root installer).
  .runCmd(
    [
      "set -e",
      "curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh",
      'bash /tmp/dotnet-install.sh --channel 8.0 --install-dir "$HOME/.dotnet"',
      'export DOTNET_ROOT="$HOME/.dotnet"',
      'export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"',
      "dotnet --info",
    ].join(" && "),
  );
