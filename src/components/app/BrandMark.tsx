import { Link } from "@tanstack/react-router";
import { BrandWordmark } from "@/components/brand-wordmark";

/** Sidebar lockup — same mark-as-L wordmark as marketing. */
export function BrandMark() {
  return (
    <Link to="/dashboard" className="group flex min-w-0 items-center" aria-label="LaunchReadyy">
      <BrandWordmark
        size="nav"
        className="truncate font-display text-[15px] font-semibold tracking-tight transition-opacity duration-200 group-hover:opacity-90"
      />
    </Link>
  );
}
