import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy — LaunchReadyy" }],
  }),
  component: PrivacyPage,
});

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 font-display text-lg font-semibold text-foreground">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 leading-relaxed">{children}</p>;
}

function UL({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-6 py-12 text-sm text-muted-foreground">
        <h1 className="font-display text-3xl font-semibold text-foreground">Privacy</h1>
        <p className="mt-2 text-xs">Last updated: September 18, 2026</p>

        <P>
          LaunchReadyy Community is self-hosted software with no LaunchReadyy account and no
          LaunchReadyy server in the loop. There's no company on the other end collecting your
          repository data — this page explains how your installation handles data.
        </P>

        <H2>1. Your browser</H2>
        <P>
          The application doesn't run analytics or tracking scripts or set advertising cookies. Your
          browser stores a theme preference in local storage.
        </P>

        <H2>2. The software</H2>
        <P>
          When you self-host LaunchReadyy, everything runs on your own machine or infrastructure:
        </P>
        <UL
          items={[
            "Data lives in a local SQLite database on disk (data/launchreadyy.db) — repos, scans, findings, fix jobs. There is no LaunchReadyy server for it to be sent to.",
            "Your GitHub personal access token, and any AI provider or E2B keys you add, are read from your own .env or data/config.json and used only to talk directly to those providers' APIs.",
            "Environment variables you save for sandbox verification are encrypted at rest (AES-256-GCM) with a key you control, and are write-only after save.",
            "There is no telemetry: the software does not phone home usage data, crash reports, or analytics to any LaunchReadyy-operated service, because none exists.",
          ]}
        />
        <P>
          The only places data leaves your own machine are the third-party services you personally
          choose to configure:
        </P>
        <UL
          items={[
            "GitHub — to read repository contents and open pull requests, using your own token.",
            "An AI provider (deepseek, anthropic, openai, gemini, or cursor) — only if you configure one, and only for AI-powered fixes and explanations. Excerpts of your repository files may be sent to that provider under their own terms.",
            "E2B — only if you configure it, to run ephemeral sandboxes for install/build/lint verification. Repository source and injected environment variables may be sent there for the duration of a run.",
          ]}
        />
        <P>
          If you're using someone else's LaunchReadyy instance rather than running your own, that
          operator controls the data their instance collects — contact them directly with privacy
          questions about that instance.
        </P>

        <H2>3. Deleting your data</H2>
        <P>
          Delete the <code className="text-foreground">data/</code> directory (or the specific{" "}
          <code className="text-foreground">.db</code> file) and nothing remains. Revoke GitHub
          access at any time from{" "}
          <Link to="/settings" className="text-primary hover:underline">
            Settings
          </Link>{" "}
          or directly in GitHub's token settings.
        </P>

        <H2>4. Changes</H2>
        <P>
          We may update this page from time to time; the date above reflects the latest revision.
        </P>

        <H2>5. Contact</H2>
        <P>
          Questions:{" "}
          <a href="mailto:launchreadyy@gmail.com" className="text-primary hover:underline">
            launchreadyy@gmail.com
          </a>
        </P>
      </article>
      <SiteFooter />
    </div>
  );
}
