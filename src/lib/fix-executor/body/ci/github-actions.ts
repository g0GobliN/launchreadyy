export function parsePackageManagerVersion(
  packageManager: string | undefined,
  name: "pnpm" | "yarn",
): string | undefined {
  if (!packageManager) return undefined;
  const match = packageManager.match(new RegExp(`^${name}@(.+)$`));
  return match?.[1];
}

export function ciWorkflow(nodeVersion: string, pnpmVersion?: string): string {
  // Do not let an unpinned repository silently inherit pnpm's newest major. Major 10 enables
  // strict dependency-build approval behavior that rejects many existing lockfiles in CI.
  const pnpmVersionLine = `\n          version: ${pnpmVersion ?? "9"}`;

  return `name: CI

on:
  push:
    branches: [main, master, develop]
  pull_request:

jobs:
  ci:
    name: CI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - id: pm
        name: Detect package manager
        run: |
          if [ -f pnpm-lock.yaml ]; then
            echo "name=pnpm"                              >> $GITHUB_OUTPUT
            echo "install=pnpm install" >> $GITHUB_OUTPUT
            echo "run=pnpm run"                           >> $GITHUB_OUTPUT
            echo "cache=pnpm"                             >> $GITHUB_OUTPUT
            echo "detect=node --input-type=commonjs"              >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          elif [ -f yarn.lock ]; then
            echo "name=yarn"                              >> $GITHUB_OUTPUT
            echo "run=yarn"                               >> $GITHUB_OUTPUT
            echo "cache=yarn"                             >> $GITHUB_OUTPUT
            echo "detect=node --input-type=commonjs"              >> $GITHUB_OUTPUT
            if [ -f .yarnrc.yml ]; then
              echo "install=yarn install"     >> $GITHUB_OUTPUT
              echo "berry=true"                           >> $GITHUB_OUTPUT
            else
              echo "install=yarn install" >> $GITHUB_OUTPUT
              echo "berry=false"                          >> $GITHUB_OUTPUT
            fi
          elif [ -f bun.lockb ] || [ -f bun.lock ]; then
            echo "name=bun"                               >> $GITHUB_OUTPUT
            echo "install=bun install"  >> $GITHUB_OUTPUT
            echo "run=bun run"                            >> $GITHUB_OUTPUT
            echo "cache="                                 >> $GITHUB_OUTPUT
            echo "detect=bun"                             >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          elif [ -f package-lock.json ]; then
            echo "name=npm"                               >> $GITHUB_OUTPUT
            echo "install=npm install"                    >> $GITHUB_OUTPUT
            echo "run=npm run"                            >> $GITHUB_OUTPUT
            echo "cache=npm"                              >> $GITHUB_OUTPUT
            echo "detect=node --input-type=commonjs"              >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          else
            echo "name=npm"                               >> $GITHUB_OUTPUT
            echo "install=npm install"                    >> $GITHUB_OUTPUT
            echo "run=npm run"                            >> $GITHUB_OUTPUT
            echo "cache="                                 >> $GITHUB_OUTPUT
            echo "detect=node --input-type=commonjs"              >> $GITHUB_OUTPUT
            echo "berry=false"                            >> $GITHUB_OUTPUT
          fi

      - if: steps.pm.outputs.name == 'pnpm'
        uses: pnpm/action-setup@v4
        with:
          run_install: false${pnpmVersionLine}

      - if: steps.pm.outputs.name == 'bun'
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - if: steps.pm.outputs.berry == 'true'
        name: Enable Corepack
        run: corepack enable

      - if: steps.pm.outputs.name != 'bun'
        uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'
          cache: \${{ steps.pm.outputs.cache }}

      - name: Install dependencies
        run: \${{ steps.pm.outputs.install }}

      - name: Lint
        run: |
          if \${{ steps.pm.outputs.detect }} -e "process.exit(require('./package.json').scripts?.lint ? 0 : 1)" 2>/dev/null; then
            \${{ steps.pm.outputs.run }} lint
          fi

      - name: Typecheck
        run: |
          if \${{ steps.pm.outputs.detect }} -e "process.exit(require('./package.json').scripts?.typecheck ? 0 : 1)" 2>/dev/null; then
            \${{ steps.pm.outputs.run }} typecheck
          fi

      - name: Test
        run: |
          if \${{ steps.pm.outputs.detect }} -e "
            const t = require('./package.json').scripts?.test;
            process.exit(!t || /no test specified/i.test(t) ? 1 : 0);
          " 2>/dev/null; then
            \${{ steps.pm.outputs.run }} test
          fi

      - name: Build
        run: |
          if \${{ steps.pm.outputs.detect }} -e "process.exit(require('./package.json').scripts?.build ? 0 : 1)" 2>/dev/null; then
            \${{ steps.pm.outputs.run }} build
          fi
`;
}
