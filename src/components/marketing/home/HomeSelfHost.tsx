import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Github, KeyRound, Server } from "lucide-react";
import { PUBLIC_GITHUB_URL } from "@/lib/app-url";
import { HomeReveal } from "./HomeReveal";
import { HomeSection } from "./HomeSection";

const PROVIDERS = [
  { name: "GitHub", detail: "Personal access token + repo access and PR creation", required: true },
  { name: "AI provider", detail: "DeepSeek, OpenAI, Anthropic, Gemini or Cursor", required: false },
  { name: "e2b.dev", detail: "Sandboxed install / build / lint verification", required: false },
];

const INSTALL = [
  "git clone " + (PUBLIC_GITHUB_URL ? `${PUBLIC_GITHUB_URL}.git` : "<this-repo>"),
  "cd launchreadyy && npm install",
  "cp .env.example .env   # fill in YOUR keys",
  "npm run dev",
];

export function HomeSelfHost() {
  return (
    <HomeSection tone="muted">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <HomeReveal>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
              Self-hosted
            </p>
            <h2 className="mt-4 font-display text-3xl tracking-[-0.03em] text-white sm:text-4xl">
              Your repo, your accounts, your machine
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/50">
              Bring your own vendor credentials and run LaunchReadyy Community on your laptop, a
              VPS, or a Node.js server. The application calls the services you configure directly
              and keeps its persistent data in local SQLite.
            </p>

            <pre className="mt-8 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-5 font-mono text-xs leading-relaxed text-white/70">
              <code>{INSTALL.join("\n")}</code>
            </pre>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/docs"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black transition hover:bg-white/90"
              >
                <BookOpen className="h-4 w-4" />
                Installation guide
              </Link>
              {PUBLIC_GITHUB_URL && (
                <a
                  href={PUBLIC_GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 text-sm font-medium text-white/90 transition hover:bg-white/10"
                >
                  <Github className="h-4 w-4" />
                  Source & architecture
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </div>
          </HomeReveal>

          <HomeReveal delay={0.08}>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
                <KeyRound className="h-4 w-4 text-white/50" />
                Bring your own keys
              </div>
              <ul className="mt-5 space-y-4">
                {PROVIDERS.map((p) => (
                  <li key={p.name} className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-white/80">{p.name}</p>
                      <p className="mt-0.5 text-xs text-white/40">{p.detail}</p>
                    </div>
                    <span
                      className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                        p.required
                          ? "border-white/15 text-white/50"
                          : "border-white/[0.08] text-white/30"
                      }`}
                    >
                      {p.required ? "required" : "optional"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 flex items-start gap-2 border-t border-white/[0.06] pt-5 text-xs text-white/40">
                <Server className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Only GitHub is needed to scan a repo. AI fixes and sandbox verification stay
                unavailable until you add those keys.
              </p>
            </div>
          </HomeReveal>
        </div>
      </div>
    </HomeSection>
  );
}
