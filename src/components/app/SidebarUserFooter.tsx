import type { AppSidebarUser } from "@/components/app/AppSidebar";

export function SidebarUserFooter({ user }: { user: AppSidebarUser }) {
  return (
    <div className="shrink-0 border-t border-hairline p-3">
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full ring-1 ring-border"
            />
          ) : (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground">
              {user.login[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">Local operator</p>
            <p className="truncate text-sm font-medium text-foreground">@{user.login}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
