import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

type SandboxVerifyStatus = "queued" | "running" | "passed" | "failed" | "skipped";

/**
 * Redirects to the sandbox retry screen when verification is still running or failed,
 * so pages built on findings (blockers, fix PR, architecture, live security) never
 * render results derived from an unverified or broken sandbox run.
 */
export function useSandboxGate(params: {
  scan: { sandboxVerify?: { status: SandboxVerifyStatus } | null } | null | undefined;
  repoId: string;
}) {
  const router = useRouter();
  const sandboxStatus = params.scan?.sandboxVerify?.status ?? null;
  const blocked =
    sandboxStatus === "queued" || sandboxStatus === "running" || sandboxStatus === "failed";

  useEffect(() => {
    if (!params.scan || !blocked) return;
    void router.navigate({
      to: "/repo/$repoId/sandbox",
      params: { repoId: params.repoId },
      search: {},
      replace: true,
    });
  }, [params.scan, blocked, params.repoId, router]);

  return { sandboxStatus, blocked };
}
