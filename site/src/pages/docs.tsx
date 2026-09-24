import { CodeBlock } from "../components/code";
import {
  DocsCards,
  DocsFaq,
  DocsLayout,
  DocsNote,
  DocsSection,
  DocsTable,
} from "../components/docs";
import { Link } from "../components/link";
import { PageHero } from "../components/page";
import { LOCAL_URL, REPO_URL, repoDoc, repoFile } from "../lib/site";

const INSTALL = `git clone ${REPO_URL}.git
cd launchreadyy
npm install
npm run build
npx launchreadyy setup
npx launchreadyy start`;

const CONFIG_ROWS: [string, string, string][] = [
  [
    "GITHUB_TOKEN",
    "Reads repositories and creates branches and pull requests. Scopes: repo, read:user, workflow.",
    "Repository features",
  ],
  ["SESSION_SECRET", "Signs this installation's local session.", "Yes"],
  [
    "ENV_VAR_ENCRYPTION_SECRET",
    "Encrypts saved project variables at rest with AES-256-GCM before a sandbox run.",
    "With saved variables",
  ],
  ["E2B_API_KEY", "Runs install, build, lint, and test in an isolated sandbox.", "No"],
  ["AI_PROVIDER and provider key", "Generates fixes, tests, and explanations.", "No"],
  ["APP_URL, HOST, PORT", "Sets the installation URL and the server bind address.", "No"],
];

const NEXT_STEPS = [
  {
    title: "System architecture",
    body: "Process topology, request flow, and how the scanner, sandbox, and fix pipeline fit together.",
    href: repoDoc("reference/02-system-architecture.md"),
  },
  {
    title: "Environment variables",
    body: "Every setting, what it enables, and what an installation does when it is unset.",
    href: repoDoc("reference/15-environment-variables.md"),
  },
  {
    title: "API reference",
    body: "Server function modules and route contracts exposed by the Community application.",
    href: repoDoc("reference/14-api.md"),
  },
  {
    title: "Security reference",
    body: "Identity model, credential handling, and the known gaps documented by the project.",
    href: repoDoc("reference/16-security.md"),
  },
  {
    title: "Deployment guide",
    body: "Build, run, and roll back the production process on your own infrastructure.",
    href: repoDoc("guides/deployment.md"),
  },
  {
    title: "Production checklist",
    body: "Schema, secrets, smoke tests, and the go-live matrix before an installation serves work.",
    href: repoDoc("guides/production.md"),
  },
  {
    title: "Operations",
    body: "Health checks and troubleshooting for a running installation.",
    href: repoDoc("guides/operations.md"),
  },
  {
    title: "Full documentation",
    body: "Every reference chapter in one file, for searching, printing, or handover.",
    href: repoDoc("FULL_DOCUMENTATION.md"),
  },
];

export function Docs() {
  return (
    <div className="page-shell">
      <PageHero
        eyebrow="Documentation"
        title="Run LaunchReadyy Community."
        intro="Install, configure, and operate the Community application on infrastructure you control. The repository holds the complete reference; this page is the short path into it."
      />

      <DocsLayout>
        <DocsSection
          id="overview"
          title="Overview"
          lead="LaunchReadyy Community reads a repository, attaches evidence to what it finds, scores release readiness, and — when you configure providers — verifies behavior and prepares remediation."
        >
          <ul className="docs-list">
            <li>
              One Node.js process serves the web application, its server functions, the background
              worker, and the scheduler.
            </li>
            <li>
              State is local: scan results, findings, job history, and configuration live in a
              SQLite database under <code>data/</code>.
            </li>
            <li>
              The server binds to loopback by default and has no login of its own, so anything
              network-accessible belongs behind an authenticating proxy.
            </li>
            <li>
              Credentials are read server-side. Repository data is never sent to LaunchReadyy.
            </li>
            <li>No accounts, no telemetry, and no hosted service in the data path.</li>
            <li>
              <strong>This website is separate.</strong> It is a static project that runs no scans
              and holds no application data.
            </li>
          </ul>
        </DocsSection>

        <DocsSection
          id="quick-start"
          title="Quick start"
          lead="Clone the repository, build the application, and run the interactive setup. Commands follow the repository README."
        >
          <CodeBlock code={INSTALL} label="Install and run" />
          <p>
            The server prints its address when it starts; the default is <code>{LOCAL_URL}</code>.
            Setup writes your local configuration interactively, and{" "}
            <code>npx launchreadyy doctor</code> validates the installation and whichever providers
            you configured.
          </p>
          <DocsNote>
            Only <code>GITHUB_TOKEN</code> is needed for repository features. Sandbox verification
            and AI-assisted changes stay off until you supply their keys, and everything else keeps
            working without them.
          </DocsNote>
        </DocsSection>

        <DocsSection id="requirements" title="Requirements">
          <DocsTable
            head={["Requirement", "Why it is needed"]}
            rows={[
              [
                "Node.js ^20.19.0 or >=22.13.0",
                "Runs the application, worker, and scheduler in one process.",
              ],
              ["Git", "Reads repository history during scans."],
              [
                "Rust and wasm-pack",
                "Builds the optional repository indexer. `npm run build` compiles it for you.",
              ],
              [
                "GitHub personal access token",
                "Reads repositories and opens pull requests. Scopes: repo, read:user, workflow.",
              ],
              [
                <>
                  <code>E2B_API_KEY</code> — optional
                </>,
                "Runs isolated verification of install, build, lint, and test steps.",
              ],
              [
                <>AI provider key — optional</>,
                "Generates fixes, tests, and explanations on top of deterministic scanning.",
              ],
            ]}
          />
        </DocsSection>

        <DocsSection
          id="configuration"
          title="Configuration"
          lead="Start from .env.example or let the setup command write the file for you."
        >
          <DocsTable
            head={["Setting", "Purpose", "Required"]}
            rows={CONFIG_ROWS.map(([setting, purpose, required]) => [
              <code key={setting}>{setting}</code>,
              purpose,
              required,
            ])}
          />
          <DocsNote>
            After <code>launchreadyy setup</code> has run, <code>data/config.json</code> is
            authoritative and <code>.env</code> becomes the fallback. Prefer{" "}
            <code>npx launchreadyy config</code> over hand-editing: a <code>.env</code> value that
            disagrees with the stored configuration is ignored, and <code>launchreadyy doctor</code>{" "}
            reports the mismatch.
          </DocsNote>
        </DocsSection>

        <DocsSection
          id="development"
          title="Development"
          lead="The application is a Vite and TanStack Start project; the readiness indexer is a Rust crate compiled to WebAssembly."
        >
          <CodeBlock
            code={`npm run dev          # dev server
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # unit suite`}
            label="Working on the code"
          />
          <p>
            Before opening a pull request, <code>typecheck</code>, <code>lint</code>, and{" "}
            <code>test</code> must pass; CI enforces all three alongside <code>docs:check</code> and
            the licensing check. The full gate list and contribution rules are in{" "}
            <a href={repoFile("CONTRIBUTING.md")} target="_blank" rel="noreferrer">
              CONTRIBUTING.md
            </a>
            .
          </p>
          <DocsNote>
            A fresh clone cannot run <code>npm run typecheck</code> until the indexer artifact
            exists. WebAssembly build output is git-ignored, so run <code>npm run build</code> (or{" "}
            <code>npm run wasm:build</code>) once — otherwise TypeScript cannot resolve{" "}
            <code>rust/crates/indexer/pkg/*</code>.
          </DocsNote>
        </DocsSection>

        <DocsSection
          id="deployment"
          title="Self-hosting"
          lead="The production build is a single Node.js process. Give it a directory it can write to and a proxy in front of it."
        >
          <CodeBlock
            code={`npm run build
npm run start`}
            label="Production process"
          />
          <ul className="docs-list">
            <li>
              Persistent data lives in <code>data/launchreadyy.db</code>. Back that directory up
              together with <code>.env</code> and <code>data/config.json</code>.
            </li>
            <li>
              Protect <code>data/</code> and the environment file: they hold repository credentials,
              provider keys, and encrypted variables.
            </li>
            <li>
              If you expose the instance beyond loopback, terminate TLS and require authentication
              at the proxy or on a private network.
            </li>
            <li>
              Behind a proxy, set <code>APP_URL</code> and <code>VITE_APP_URL</code>. The second is
              read at build time by absolute URLs such as canonical and share links.
            </li>
          </ul>
          <p>
            Step-by-step procedures live in the{" "}
            <a href={repoDoc("guides/deployment.md")} target="_blank" rel="noreferrer">
              deployment guide
            </a>{" "}
            and the{" "}
            <a href={repoDoc("guides/production.md")} target="_blank" rel="noreferrer">
              production checklist
            </a>
            .
          </p>
        </DocsSection>

        <DocsSection
          id="security"
          title="Security model"
          lead="Community holds the credentials to your repositories, so its own boundary matters more than its feature list."
        >
          <ul className="docs-list">
            <li>Provider credentials are read server-side and never sent to the browser.</li>
            <li>
              Saved project variables are encrypted with AES-256-GCM before being stored or shipped
              to a sandbox run.
            </li>
            <li>Live-site checks require domain ownership confirmation before they run.</li>
            <li>
              Source excerpts reach only the AI provider the operator configures, and only for
              AI-assisted operations.
            </li>
            <li>Verification runs in an isolated sandbox rather than on the host.</li>
            <li>The application sends no telemetry.</li>
          </ul>
          <p>
            Report vulnerabilities through the repository's{" "}
            <a href={`${REPO_URL}/security/advisories/new`} target="_blank" rel="noreferrer">
              private advisory flow
            </a>{" "}
            rather than a public issue. The <Link href="/security">security page</Link> covers the
            boundary and hardening, and the full policy is in{" "}
            <a href={repoFile("SECURITY.md")} target="_blank" rel="noreferrer">
              SECURITY.md
            </a>
            .
          </p>
        </DocsSection>

        <DocsSection
          id="operations"
          title="Operations"
          lead="A running installation is one process with a local database, so day-to-day operations are backups, upgrades, and reading the scan history."
        >
          <ul className="docs-list">
            <li>Scan history and readiness scores accumulate per repository over time.</li>
            <li>
              Scheduled re-scans and live-site monitoring run inside the same process, driven by the
              scheduler and the job worker.
            </li>
            <li>
              Upgrades are a rebuild and restart: pull the release, <code>npm install</code>,{" "}
              <code>npm run build</code>, then restart. The schema is applied on startup.
            </li>
            <li>
              When something looks wrong, the{" "}
              <a href={repoDoc("guides/operations.md")} target="_blank" rel="noreferrer">
                operations guide
              </a>{" "}
              starts with health checks and logs.
            </li>
          </ul>
        </DocsSection>

        <DocsSection
          id="troubleshooting"
          title="Troubleshooting"
          lead="The failures below are the ones a first installation tends to hit. Each one is a configuration gap rather than a defect."
        >
          <DocsFaq
            items={[
              {
                question: "Typecheck fails on a fresh clone with TS2307",
                answer: (
                  <>
                    The WebAssembly indexer artifact is build output and git-ignored. Run{" "}
                    <code>npm run build</code> or <code>npm run wasm:build</code> once; TypeScript
                    then resolves <code>rust/crates/indexer/pkg/*</code>.
                  </>
                ),
              },
              {
                question: "Sandbox verification is reported as skipped",
                answer: (
                  <>
                    No <code>E2B_API_KEY</code> is configured. Scanning, scoring, and template fixes
                    run without it — verification simply reports itself as skipped instead of
                    failing.
                  </>
                ),
              },
              {
                question: "AI-assisted fixes and tests are unavailable",
                answer: (
                  <>
                    No AI provider key is configured. Deterministic scanning and template-based
                    fixes continue to work; add a provider key to enable generation.
                  </>
                ),
              },
              {
                question: "The port is already in use",
                answer: (
                  <>
                    Something else holds <code>PORT</code> (5174 by default). Change it in{" "}
                    <code>.env</code>, or stop the other process. The appendix B ports table in the
                    repository lists the addresses an installation uses.
                  </>
                ),
              },
              {
                question: "Links or previews point at localhost behind a proxy",
                answer: (
                  <>
                    Set <code>APP_URL</code> and <code>VITE_APP_URL</code>. The second is read at
                    build time, so rebuild after changing it.
                  </>
                ),
              },
              {
                question: "A change to .env had no effect",
                answer: (
                  <>
                    Once setup has run, <code>data/config.json</code> is authoritative and a
                    conflicting <code>.env</code> value is ignored. Use{" "}
                    <code>npx launchreadyy config</code> to change settings, then{" "}
                    <code>npx launchreadyy doctor</code> to confirm what the server actually reads.
                  </>
                ),
              },
            ]}
          />
        </DocsSection>

        <DocsSection
          id="next-steps"
          title="Where to go next"
          lead="The repository documentation is the reference of record: 21 chapters of technical detail and four task-oriented guides."
        >
          <DocsCards items={NEXT_STEPS} />
          <p className="docs-footnote">
            Source, issues, and contribution guidance live in the{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub repository
            </a>
            . Community is distributed under Apache-2.0 — see the{" "}
            <Link href="/license">license page</Link> for the code license and the separate
            trademark policy.
          </p>
        </DocsSection>
      </DocsLayout>
    </div>
  );
}
