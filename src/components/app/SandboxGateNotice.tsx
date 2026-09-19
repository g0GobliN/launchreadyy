import { Loader2 } from "lucide-react";
import { RepoLayout } from "@/components/layouts/RepoLayout";
import type { AppSidebarUser } from "@/components/app/AppSidebar";

export function SandboxGateNotice({
  user,
  repoId,
  repoName,
}: {
  user?: AppSidebarUser | null;
  repoId: string;
  repoName: string;
}) {
  return (
    <RepoLayout user={user} repoId={repoId} repoName={repoName}>
      <div className="flex flex-col items-center py-24 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-data" />
        <p className="mt-4 text-sm text-muted-foreground">Opening sandbox…</p>
      </div>
    </RepoLayout>
  );
}
