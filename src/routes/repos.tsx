import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { AppLayout } from "@/components/layouts/AppLayout";
import { RepositoryCard } from "@/components/app/RepositoryCard";
import { EmptyState } from "@/components/app/EmptyState";
import { saveSelectedRepo, triggerScan, loadDashboardFn } from "@/lib/api/github.functions";
import { listRepoEnvVarsFn } from "@/lib/api/sandbox.functions";
import { formatDistanceToNow } from "date-fns";
import type { GitHubRepo } from "@/lib/github.server";
import { GitBranch, Search } from "lucide-react";
import { useState } from "react";
import { DashboardPageHeader, dashboardInput } from "@/components/app/DashboardKit";

export const Route = createFileRoute("/repos")({
  head: () => ({ meta: [{ title: "Repositories — LaunchReadyy" }] }),
  loader: async () => {
    const data = await loadDashboardFn();
    if (!data.user) throw redirect({ to: "/dashboard" });
    return data;
  },
  component: ReposPage,
});

function ReposPage() {
  const { user, githubRepos } = Route.useLoaderData();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scanning, setScanning] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const filtered = githubRepos.filter((r: GitHubRepo) =>
    r.full_name.toLowerCase().includes(q.toLowerCase()),
  );

  async function analyzeRepo(repo: GitHubRepo) {
    setScanning(repo.id);
    setScanError(null);
    try {
      const { repoId } = await saveSelectedRepo({
        data: {
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          language: repo.language,
          stargazers_count: repo.stargazers_count,
          updated_at: repo.updated_at,
          private: repo.private,
          owner_login: repo.owner.login,
          default_branch: repo.default_branch,
        },
      });

      const skipEnv =
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem(`env-skip-${repoId}`) === "1";
      const storedEnv = await listRepoEnvVarsFn({ data: { repoId } }).catch(() => []);
      if (!skipEnv && storedEnv.length === 0) {
        await router.navigate({
          to: "/repo/$repoId/env",
          params: { repoId },
          search: { intent: "launch" },
        });
        setScanning(null);
        return;
      }

      // Queued, not finished — the repo page is where the run is watched.
      await triggerScan({ data: { repoId } });
      await router.navigate({ to: "/repo/$repoId", params: { repoId } });
      setScanning(null);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed. Please try again.");
      setScanning(null);
    }
  }

  return (
    <AppLayout user={user} breadcrumbs={[{ label: "Repositories" }]}>
      <DashboardPageHeader
        eyebrow="Workspace"
        title="Repositories"
        description="Choose a GitHub repository to verify in a real sandbox."
      />

      {scanError && (
        <div className="mt-4 rounded-2xl border border-foreground/25 bg-muted px-4 py-3 text-sm font-medium text-foreground">
          {scanError}
        </div>
      )}

      <div className="relative mt-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search repositories..."
          className={`${dashboardInput} pl-10`}
        />
      </div>

      <div className="mt-3 space-y-2">
        {filtered.map((r: GitHubRepo) => (
          <RepositoryCard
            key={r.id}
            name={r.full_name}
            description={r.description}
            language={r.language}
            private={r.private}
            defaultBranch={r.default_branch}
            updatedAt={
              r.updated_at ? formatDistanceToNow(new Date(r.updated_at), { addSuffix: true }) : null
            }
            loading={scanning === r.id}
            onAction={() => void analyzeRepo(r)}
            actionLabel={scanning === r.id ? "Starting…" : "Analyze"}
          />
        ))}
        {filtered.length === 0 && githubRepos.length > 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-surface/60 p-10 text-center text-sm text-muted-foreground">
            No repos match your search.
          </div>
        )}
        {githubRepos.length === 0 && (
          <EmptyState
            icon={GitBranch}
            title="No repositories found"
            body="We could not read any repos from your GitHub account. Usually this means GITHUB_TOKEN is missing, expired, or missing scopes."
            steps={[
              "Check that GITHUB_TOKEN is set in .env or via launchreadyy config.",
              "Make sure the token has the repo, read:user, and workflow scopes.",
              "Run launchreadyy doctor to validate it against the GitHub API, then restart.",
            ]}
            secondary="Token looks fine and still empty? The account may have no repos yet."
          />
        )}
      </div>
    </AppLayout>
  );
}
