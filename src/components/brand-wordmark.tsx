import { cn } from "@/lib/utils";

type BrandWordmarkSize = "hero" | "nav";

const markSizeClass: Record<BrandWordmarkSize, string> = {
  // Display / hero — optical letter in large type
  hero: "h-[0.78em] w-[0.72em] translate-y-[0.05em] [mask-size:contain] [-webkit-mask-size:contain]",
  // Compact chrome — slight stretch + optical align with wordmark
  nav: "h-[0.95em] w-[0.78em] -translate-y-[0.03em] [mask-size:100%_108%] [-webkit-mask-size:100%_108%]",
};

/**
 * Brand lockup: mark replaces the L — [mark]aunchReadyy.
 * `nav` stretches the mark taller for small header/sidebar sizes.
 */
export function BrandWordmark({
  className,
  size = "hero",
}: {
  className?: string;
  size?: BrandWordmarkSize;
}) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap text-foreground",
        size === "nav" ? "items-center" : "items-baseline",
        className,
      )}
      aria-label="LaunchReadyy"
    >
      <span
        aria-hidden
        className={cn(
          "mr-0 inline-block shrink-0 bg-current align-baseline",
          "[mask-image:url(/logo/mark-tight.png)] [mask-position:right_center] [mask-repeat:no-repeat]",
          "[-webkit-mask-image:url(/logo/mark-tight.png)] [-webkit-mask-position:right_center] [-webkit-mask-repeat:no-repeat]",
          markSizeClass[size],
        )}
      />
      <span className="tracking-[-0.02em]">
        aunch<span className="text-primary">Readyy</span>
      </span>
    </span>
  );
}
