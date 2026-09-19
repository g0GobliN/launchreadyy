import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared home section shell — hairline rule + optional wash so blocks don’t blend. */
export function HomeSection({
  children,
  className,
  tone = "default",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "muted";
  as?: "section" | "div";
}) {
  return (
    <Tag
      className={cn(
        "home-section border-t border-white/[0.08]",
        tone === "muted" && "home-section--muted",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
