import type { ReactNode } from "react";

/** 60/40 split for fix review: diff left, actions right. */
export function SplitPanelLayout({
  left,
  right,
  header,
}: {
  left: ReactNode;
  right: ReactNode;
  header?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header && <div className="shrink-0 border-b border-border bg-card px-4 py-3">{header}</div>}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[3fr_2fr]">
        <div className="min-h-0 overflow-auto border-b border-border lg:border-b-0 lg:border-r">
          {left}
        </div>
        <div className="min-h-0 overflow-auto bg-card">{right}</div>
      </div>
    </div>
  );
}
