import { AlertCircle, Check, ClipboardCopy, Terminal } from "lucide-react";

export function FixReviewHelpPanel({
  phase = "pre-pr",
  previewIssues,
  onCopyIssues,
  onPasteIntoFeedback,
  copied,
}: {
  phase?: "pre-pr" | "post-pr";
  previewIssues: string[];
  onCopyIssues?: () => void;
  onPasteIntoFeedback?: () => void;
  copied?: boolean;
}) {
  const isPostPr = phase === "post-pr";
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Terminal className="h-4 w-4 shrink-0 text-primary" />
        Errors from CI or your IDE
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {isPostPr ? (
          <>
            Your PR is open — run CI or tests on the branch. If something fails, paste the log in{" "}
            <span className="text-foreground">Not quite right?</span> and we&apos;ll try to fix it.
          </>
        ) : (
          <>
            This preview shows <span className="text-foreground">file diffs only</span> — we
            don&apos;t install deps, start your server, or run tests. A green preview doesn&apos;t
            mean CI will pass in your repo.
          </>
        )}
      </p>

      <div className="rounded-md border border-border/80 bg-surface/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">When to use this</p>
        <p>
          {isPostPr ? (
            <>
              After <span className="text-foreground">checkout or merge</span> — GitHub Actions red,
              Playwright timeout, lint error, or IDE diagnostic on the new files.
            </>
          ) : (
            <>
              After you <span className="text-foreground">approve the PR</span> or{" "}
              <span className="text-foreground">checkout the branch</span> — if GitHub Actions
              fails, Playwright times out, lint breaks, or your IDE shows errors.
            </>
          )}
        </p>
      </div>

      <ol className="list-decimal space-y-2.5 pl-4 text-xs text-muted-foreground">
        <li>
          <span className="text-foreground">Run the same checks locally</span> — e.g.{" "}
          <span className="font-mono">npm test</span>,{" "}
          <span className="font-mono">npm run test:e2e</span>,{" "}
          <span className="font-mono">npm run lint</span>, or open the failed job in GitHub Actions
        </li>
        <li>
          <span className="text-foreground">Copy the full error</span> — stack trace, failed test
          name, file path, and the line it expected vs got (not just &quot;tests failed&quot;)
        </li>
        <li>
          Paste into <span className="font-medium text-foreground">Not quite right?</span>{" "}
          {isPostPr ? "on this page" : "below"} →{" "}
          <span className="font-medium text-foreground">Try again</span>.
          {isPostPr
            ? " We diagnose the failure and can open a follow-up fix PR."
            : " We regenerate using your error output."}
        </li>
      </ol>

      <p className="text-[11px] text-muted-foreground/90 leading-relaxed">
        <span className="text-foreground">Tip:</span> include the command you ran and 10–20 lines
        around the failure. Example:{" "}
        <span className="font-mono text-[10px]">
          playwright: Timeout 30000ms — locator getByRole(&apos;heading&apos;) on /checkout
        </span>
      </p>

      {previewIssues.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Caught before PR (rare)
          </div>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {previewIssues.map((issue) => (
              <li key={issue} className="font-mono break-all">
                {issue}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {onCopyIssues && (
              <button
                type="button"
                onClick={onCopyIssues}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <ClipboardCopy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            {onPasteIntoFeedback && (
              <button
                type="button"
                onClick={onPasteIntoFeedback}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
              >
                Paste into feedback
              </button>
            )}
          </div>
        </div>
      ) : isPostPr ? (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground leading-relaxed">
          Paste CI or terminal output in the box on the left when you&apos;re ready — no need to
          re-scan unless the whole fix approach was wrong.
        </p>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Nothing flagged here yet</span> — syntax and
          obvious template issues would show above. Most real failures (wrong selectors, missing
          env, CI config) only appear once the code runs in your project. Approve if it looks right;
          come back with logs if something breaks.
        </p>
      )}
    </div>
  );
}
