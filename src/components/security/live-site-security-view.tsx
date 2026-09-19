"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  confirmDomainFn,
  getDomainVerifyChallengeFn,
  getLiveSiteScanFn,
  listLiveSiteScansFn,
  startLiveSiteScanFn,
} from "@/lib/api/security.functions";
import { FindingWhyAndEvidence } from "@/components/finding-evidence";
import { ScoreRing, SeverityBadge } from "@/components/ui-bits";
import { pollUntil } from "@/lib/poll-until";
import { FIX_DETAILS, type Issue, type Severity } from "@/lib/mock-data";
import { getFixEffortLabel } from "@/lib/fix-meta";
import { liveFindingToRepoFixId } from "@/lib/live-fix-mapping";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Globe, Loader2, Shield } from "lucide-react";

const HISTORY_CAP = 10;

type LiveFinding = {
  title?: string;
  severity?: string;
  why?: string;
  fixId?: string;
  checkedFor?: string[];
  foundEvidence?: string;
  confidence?: string;
  recommendedFix?: string;
  detection?: string[];
  timeSaved?: string;
};

type ScanSummary = {
  id: string;
  domain: string;
  status: string;
  security_score: number | null;
  created_at: string;
  finished_at: string | null;
};

type ActiveScan = {
  id: string;
  domain: string;
  status: string;
  security_score: number | null;
  results: LiveFinding[];
  created_at: string;
};

function toIssue(f: LiveFinding, i: number): Issue {
  const sev = (f.severity ?? "medium") as Severity;
  return {
    id: f.fixId ?? `live-${i}`,
    category: "Security",
    title: f.title ?? "Finding",
    severity: sev,
    why: f.why ?? "",
    timeSaved: f.timeSaved ?? "30m",
    fixId: f.fixId ?? `live-finding-${i}`,
    checkedFor: f.checkedFor,
    foundEvidence: f.foundEvidence,
    confidence: (f.confidence as Issue["confidence"]) ?? "high",
    recommendedFix: f.recommendedFix,
    detection: f.detection as Issue["detection"],
    autoFixable: false,
    priority: sev === "critical" ? 1 : sev === "high" ? 2 : 5,
  };
}

export function LiveSiteSecurityView({
  repoId,
  initialScanId,
  history: initialHistory,
}: {
  repoId: string;
  initialScanId?: string;
  history: ScanSummary[];
}) {
  const [domain, setDomain] = useState("");
  // `ownershipChecked` is just the checkbox — user intent. `confirmed` means the server has
  // actually recorded that confirmation (confirmDomainFn); only that should unlock the scan.
  // They used to be the same boolean, which let "Start live scan" enable itself the instant
  // the box was ticked, before "Save confirmation" ever ran — the server then rejected the
  // scan because nothing was actually saved.
  const [ownershipChecked, setOwnershipChecked] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [challenge, setChallenge] = useState<{
    token: string;
    path: string;
    url: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveScan | null>(null);
  const [history, setHistory] = useState(() => initialHistory.slice(0, HISTORY_CAP));
  /** Selected repo-side fix ids (helmet / https-redirect / …), chosen from findings. */
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(() => new Set());

  const loadScan = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const row = await getLiveSiteScanFn({ data: { liveScanId: id } });
      setActive({
        id: row.id,
        domain: row.domain,
        status: row.status,
        security_score: row.security_score,
        results: row.results,
        created_at: row.created_at,
      });
      setDomain(row.domain);
      setSelectedFixes(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scan");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialScanId) {
      void loadScan(initialScanId);
      return;
    }
    const latest = initialHistory.find((h) => h.status === "completed");
    if (latest) void loadScan(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshHistory() {
    const rows = await listLiveSiteScansFn({ data: { repoId, limit: HISTORY_CAP } });
    setHistory((rows as ScanSummary[]).slice(0, HISTORY_CAP));
  }

  async function loadChallenge(nextDomain: string) {
    const trimmed = nextDomain.trim();
    if (trimmed.length < 3) {
      setChallenge(null);
      return;
    }
    try {
      const ch = await getDomainVerifyChallengeFn({ data: { domain: trimmed } });
      setChallenge({ token: ch.token, path: ch.path, url: ch.url });
    } catch {
      setChallenge(null);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmDomainFn({ data: { domain } });
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  async function poll(id: string) {
    const result = await pollUntil(
      () => getLiveSiteScanFn({ data: { liveScanId: id } }),
      (row) => row.status === "completed" || row.status === "failed",
    );
    if (result === "timeout") {
      setError("Scan timed out — check history in a moment.");
      setBusy(false);
      return;
    }
    setActive({
      id: result.id,
      domain: result.domain,
      status: result.status,
      security_score: result.security_score,
      results: result.results,
      created_at: result.created_at,
    });
    await refreshHistory();
    setBusy(false);
  }

  async function start() {
    setBusy(true);
    setError(null);
    setActive(null);
    setSelectedFixes(new Set());
    try {
      const res = await startLiveSiteScanFn({ data: { domain, repoId } });
      setActive({
        id: res.liveScanId,
        domain,
        status: "queued",
        security_score: null,
        results: [],
        created_at: new Date().toISOString(),
      });
      // Optimistic: push newest, drop oldest beyond cap
      setHistory((prev) =>
        [
          {
            id: res.liveScanId,
            domain,
            status: "queued",
            security_score: null,
            created_at: new Date().toISOString(),
            finished_at: null,
          },
          ...prev,
        ].slice(0, HISTORY_CAP),
      );
      void poll(res.liveScanId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed to start");
      setBusy(false);
    }
  }

  const issues = active?.results.map(toIssue) ?? [];
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;

  /** One UI card per Fix PR (Helmet headers collapse into a single group). */
  type FixGroup = {
    key: string;
    repoFixId: string | null;
    issues: Issue[];
    worstSeverity: Severity;
  };

  const fixGroups = useMemo((): FixGroup[] => {
    const sortedIssues = [...issues].sort(
      (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
    );
    const groups = new Map<string, FixGroup>();
    for (const issue of sortedIssues) {
      const repoFixId = liveFindingToRepoFixId(issue.fixId);
      const key = repoFixId ?? `solo:${issue.fixId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.issues.push(issue);
        if ((severityOrder[issue.severity] ?? 9) < (severityOrder[existing.worstSeverity] ?? 9)) {
          existing.worstSeverity = issue.severity;
        }
      } else {
        groups.set(key, {
          key,
          repoFixId,
          issues: [issue],
          worstSeverity: issue.severity,
        });
      }
    }
    return [...groups.values()].sort(
      (a, b) => (severityOrder[a.worstSeverity] ?? 9) - (severityOrder[b.worstSeverity] ?? 9),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- issues rebuilt from active.results
  }, [active?.results]);

  function toggleFix(repoFixId: string) {
    setSelectedFixes((prev) => {
      const next = new Set(prev);
      if (next.has(repoFixId)) next.delete(repoFixId);
      else next.add(repoFixId);
      return next;
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px] lg:items-start">
      {/* Left — form + findings */}
      <div className="min-w-0 space-y-6">
        <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold">Scan a live domain</h2>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Passive checks only — HTTPS, headers, cookies, path exposure. No exploit payloads.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="live-domain">
                Domain
              </label>
              <input
                id="live-domain"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setOwnershipChecked(false);
                  setConfirmed(false);
                  setChallenge(null);
                }}
                onBlur={() => void loadChallenge(domain)}
                placeholder="example.com"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={ownershipChecked}
                onChange={(e) => {
                  setOwnershipChecked(e.target.checked);
                  if (!e.target.checked) setConfirmed(false);
                  else void loadChallenge(domain);
                }}
                className="mt-0.5"
              />
              I confirm that I own this domain or have permission to test it.
            </label>

            {ownershipChecked && challenge && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-2">
                <p className="font-medium text-foreground">Prove ownership</p>
                <p className="text-muted-foreground leading-relaxed">
                  Publish a text file at <code className="text-foreground">{challenge.path}</code>{" "}
                  on this domain. Body must include:
                </p>
                <code className="block break-all rounded bg-background px-2 py-1.5 text-foreground">
                  {challenge.token}
                </code>
                <p className="text-muted-foreground">
                  Then click Save confirmation — we fetch{" "}
                  <span className="text-foreground">{challenge.url}</span>.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !domain || !ownershipChecked}
                onClick={() => void confirm()}
                className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
              >
                Save confirmation
              </button>
              <button
                type="button"
                disabled={busy || !domain || !confirmed}
                onClick={() => void start()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Start live scan
              </button>
            </div>

            {error && <p className="text-xs text-critical">{error}</p>}
          </div>
        </section>

        {active ? (
          <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Results
                </p>
                <h2 className="mt-1 truncate font-display text-lg font-semibold">
                  {active.domain}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {active.status === "completed"
                    ? `Completed ${formatDistanceToNow(new Date(active.created_at), { addSuffix: true })}`
                    : active.status === "failed"
                      ? "Scan failed"
                      : "Scan in progress…"}
                </p>
              </div>
              {active.security_score != null && active.status === "completed" ? (
                <ScoreRing score={active.security_score} size={88} />
              ) : active.status !== "failed" ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Running…
                </div>
              ) : null}
            </div>

            {fixGroups.length > 0 ? (
              <>
                <p className="mt-5 text-xs text-muted-foreground">
                  Choose which fixes to include. Related header findings are grouped — they share
                  one Helmet PR.
                </p>
                <ul className="mt-3 space-y-3">
                  {fixGroups.map((group) => {
                    const { repoFixId, issues: groupIssues } = group;
                    const canFix = Boolean(repoId) && repoFixId != null;
                    const selected = repoFixId ? selectedFixes.has(repoFixId) : false;
                    const cost = repoFixId ? getFixEffortLabel(repoFixId) : null;
                    const packLabel =
                      repoFixId && FIX_DETAILS[repoFixId as keyof typeof FIX_DETAILS]
                        ? FIX_DETAILS[repoFixId as keyof typeof FIX_DETAILS]!.label
                        : null;
                    const isGroup = groupIssues.length > 1;
                    const title = isGroup
                      ? (packLabel ?? "Security headers")
                      : groupIssues[0]!.title;

                    return (
                      <li
                        key={group.key}
                        className={`rounded-lg border bg-surface p-3 sm:p-4 ${
                          selected ? "border-primary/40 bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="flex flex-wrap items-start gap-3">
                          {canFix ? (
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 shrink-0 accent-[#00e5a8]"
                              checked={selected}
                              onChange={() => repoFixId && toggleFix(repoFixId)}
                              aria-label={`Select ${title}`}
                            />
                          ) : (
                            <span className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <SeverityBadge severity={group.worstSeverity} />
                              <span className="font-medium text-sm">{title}</span>
                              {isGroup && (
                                <span className="text-[11px] text-muted-foreground">
                                  {groupIssues.length} findings · one PR
                                </span>
                              )}
                            </div>

                            {isGroup ? (
                              <>
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                  These missing headers are fixed together by adding Helmet
                                  (security headers middleware) in one pull request.
                                </p>
                                <ul className="mt-2 space-y-3 border-t border-border/60 pt-2">
                                  {groupIssues.map((issue) => (
                                    <li key={issue.fixId}>
                                      <p className="text-sm font-medium text-foreground/90">
                                        {issue.title}
                                      </p>
                                      <FindingWhyAndEvidence issue={issue} />
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : (
                              <>
                                <FindingWhyAndEvidence issue={groupIssues[0]!} />
                                {!canFix && active?.status === "completed" && (
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    Fix on the host or CDN — no repo Fix PR for this one.
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                          {canFix && repoFixId && (
                            <Link
                              to="/repo/$repoId/fix"
                              params={{ repoId }}
                              search={{ fixes: repoFixId }}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted"
                            >
                              {cost}
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {repoId && (
                  <div className="sticky bottom-4 z-30 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-surface p-4 shadow-[var(--app-shadow-float)]">
                    <div className="text-sm">
                      <span className="font-medium">{selectedFixes.size}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        fix{selectedFixes.size === 1 ? "" : "es"} ready for PR
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedFixes.size > 0 && (
                        <button
                          type="button"
                          className="rounded-[5px] border border-border bg-surface px-3 py-2 text-xs hover:bg-muted"
                          onClick={() => setSelectedFixes(new Set())}
                        >
                          Clear
                        </button>
                      )}
                      <Link
                        to="/repo/$repoId/fix"
                        params={{ repoId }}
                        search={{ fixes: Array.from(selectedFixes).join(",") }}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-[5px] px-4 py-2 text-sm font-medium transition ${
                          selectedFixes.size === 0
                            ? "pointer-events-none bg-muted text-muted-foreground"
                            : "bg-primary text-primary-foreground hover:bg-[#00c990]"
                        }`}
                      >
                        Generate fix <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                )}
              </>
            ) : active.status === "completed" ? (
              <p className="mt-5 text-sm text-muted-foreground">
                No live findings — headers and exposure checks passed.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Run a scan or pick one from history to see findings here.
            </p>
          </section>
        )}
      </div>

      {/* Right — history (sticky on desktop) */}
      <aside className="lg:sticky lg:top-24 space-y-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              History
            </h2>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {history.length}/{HISTORY_CAP}
            </span>
          </div>

          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Newest scans appear here. Only the last {HISTORY_CAP} are kept — older ones drop off
              automatically.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {history.map((row) => {
                const selected = active?.id === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => void loadScan(row.id)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                        selected
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-surface hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{row.domain}</span>
                        <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                          {row.security_score != null ? row.security_score : "…"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="capitalize">{row.status}</span>
                        <span>
                          {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
