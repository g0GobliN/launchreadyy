import { useState } from "react";
import { Copy, Share2, Check, Link, Loader2 } from "lucide-react";
import { getLaunchReportFn, createLaunchReportShareFn } from "@/lib/api/launch-report.functions";

export function ShareLaunchScore({
  repoId,
  repoFullName,
  score,
  appOrigin,
  topIssue,
}: {
  repoId: string;
  repoFullName: string;
  score: number;
  appOrigin: string;
  topIssue?: string;
}) {
  const [copied, setCopied] = useState<"link" | "badge" | null>(null);
  const [busy, setBusy] = useState<"link" | "linkedin" | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const origin = appOrigin.replace(/\/$/, "");
  const badgeUrl = `${origin}/api/badge/score/${score}.svg`;
  const badgeMarkdown = `[![LaunchReadyy score](${badgeUrl})](${origin})`;

  const shareText = [
    `Just ran LaunchReadyy on ${repoFullName}.`,
    `Launch readiness: ${score}/100.`,
    topIssue ? `Top blocker: ${topIssue}` : "",
    "Vibe-coded apps ship broken — this shows what would kill you in prod.",
    origin,
  ]
    .filter(Boolean)
    .join(" ");

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  // The public launch report (a real, no-login-required URL) is the only thing safe to hand
  // out — the dashboard page itself requires being signed in as the repo owner. Reuse an
  // existing un-revoked share link if one exists instead of minting a new one on every click,
  // since creating a new one revokes the last one and would break anyone already holding it.
  async function getShareUrl(): Promise<string | null> {
    setShareError(null);
    try {
      const existing = await getLaunchReportFn({ data: { repoId } });
      if (existing.shareUrl) return existing.shareUrl;
      const created = await createLaunchReportShareFn({ data: { repoId } });
      return created.shareUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setShareError(msg);
      return null;
    }
  }

  async function copy(text: string, kind: "link" | "badge") {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleCopyLink() {
    setBusy("link");
    const url = await getShareUrl();
    if (url) await copy(url, "link");
    setBusy(null);
  }

  async function handleLinkedIn() {
    setBusy("linkedin");
    const url = await getShareUrl();
    setBusy(null);
    if (url) {
      window.open(
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
        "_blank",
        "noreferrer",
      );
    }
  }

  const btnCls =
    "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition";

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Share2 className="h-4 w-4 text-muted-foreground" />
        Share your score
      </div>

      <div className="mt-3 flex items-center gap-2">
        <img src={badgeUrl} alt={`LaunchReadyy score ${score}/100`} className="h-5" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={tweetUrl} target="_blank" rel="noreferrer" className={btnCls}>
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Post on X
        </a>

        <button
          type="button"
          onClick={handleLinkedIn}
          disabled={busy === "linkedin"}
          className={btnCls}
        >
          {busy === "linkedin" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          )}
          LinkedIn
        </button>

        <button
          type="button"
          onClick={handleCopyLink}
          disabled={busy === "link"}
          className={btnCls}
        >
          {busy === "link" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : copied === "link" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <Link className="h-3.5 w-3.5 shrink-0" />
          )}
          {copied === "link" ? "Copied!" : "Copy link"}
        </button>

        <button type="button" onClick={() => copy(badgeMarkdown, "badge")} className={btnCls}>
          {copied === "badge" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5 shrink-0" />
          )}
          {copied === "badge" ? "Copied!" : "README badge"}
        </button>
      </div>
      {shareError && <p className="mt-2 text-xs text-critical">{shareError}</p>}
    </div>
  );
}
