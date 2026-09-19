import type { ArticleBlock, ChartBar } from "@/lib/home-feed";

/** Product accent. Validated for ≥3:1 contrast against the article surface (#13131A). */
const ACCENT = "#00E5A8";

/**
 * Hand-authored diagrams, keyed by the id in a `:::diagram <id>` directive.
 *
 * Inline SVG rather than a mermaid runtime: one diagram does not justify ~500KB of
 * client-side renderer, and this way the diagram is server-rendered with the page
 * instead of popping in after hydration.
 */
const DIAGRAMS: Record<string, React.ReactNode> = {
  "benchmark-method": (
    <svg viewBox="0 0 720 260" className="w-full" role="img" aria-labelledby="bm-title">
      <title id="bm-title">
        Each repository is read three times: once by the LaunchReadyy scanner, once by an AI code
        review, and once by an independent file-based checker whose verdict is the answer key. The
        first two are then scored against the third.
      </title>
      <defs>
        <marker id="bm-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="rgba(255,255,255,0.28)" />
        </marker>
      </defs>

      <rect x="8" y="104" width="132" height="52" rx="10" fill="rgba(255,255,255,0.05)" />
      <text x="74" y="135" textAnchor="middle" className="fill-white/70 text-[13px]">
        27 real repos
      </text>

      {[
        { y: 26, label: "LaunchReadyy scan" },
        { y: 104, label: "AI code review" },
        { y: 182, label: "Independent checker" },
      ].map((row, i) => (
        <g key={row.label}>
          <path
            d={`M140 130 C 190 130, 190 ${row.y + 26}, 236 ${row.y + 26}`}
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.5"
            markerEnd="url(#bm-arrow)"
          />
          <rect
            x="240"
            y={row.y}
            width="190"
            height="52"
            rx="10"
            fill={i === 2 ? "rgba(0,229,168,0.10)" : "rgba(255,255,255,0.05)"}
            stroke={i === 2 ? "rgba(0,229,168,0.45)" : "rgba(255,255,255,0.10)"}
          />
          <text
            x="335"
            y={row.y + 31}
            textAnchor="middle"
            className={i === 2 ? "text-[13px]" : "fill-white/70 text-[13px]"}
            fill={i === 2 ? ACCENT : undefined}
          >
            {row.label}
          </text>
        </g>
      ))}

      <path
        d="M430 208 C 500 208, 500 130, 556 130"
        fill="none"
        stroke="rgba(0,229,168,0.45)"
        strokeWidth="1.5"
        markerEnd="url(#bm-arrow)"
      />
      <path
        d="M430 52 C 500 52, 500 130, 556 130"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
        markerEnd="url(#bm-arrow)"
      />
      <path
        d="M430 130 L 556 130"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
        markerEnd="url(#bm-arrow)"
      />

      <rect
        x="560"
        y="104"
        width="152"
        height="52"
        rx="10"
        fill="rgba(255,255,255,0.05)"
        stroke="rgba(255,255,255,0.10)"
      />
      <text x="636" y="128" textAnchor="middle" className="fill-white/70 text-[13px]">
        Scored against
      </text>
      <text x="636" y="145" textAnchor="middle" className="fill-white/70 text-[13px]">
        the same answer key
      </text>
    </svg>
  ),
};

function BarChart({ title, unit, bars }: { title: string; unit: string | null; bars: ChartBar[] }) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <figure className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
      <figcaption className="font-display text-sm tracking-[-0.01em] text-white">
        {title}
        {unit ? <span className="ml-2 font-mono text-[11px] text-white/35">{unit}</span> : null}
      </figcaption>
      <div className="mt-5 space-y-2.5">
        {bars.map((bar) => (
          <div key={bar.label} className="grid grid-cols-[10rem_1fr_2.5rem] items-center gap-3">
            <span className="truncate font-mono text-[11px] text-white/45" title={bar.label}>
              {bar.label}
            </span>
            {/* Track is recessive; only the value mark carries the accent. */}
            <span className="h-2.5 w-full rounded-full bg-white/[0.05]">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max((bar.value / max) * 100, 1.5)}%`,
                  backgroundColor: ACCENT,
                }}
              />
            </span>
            <span className="text-right font-mono text-[11px] tabular-nums text-white/70">
              {bar.value}
            </span>
            {bar.note ? (
              <span className="col-start-2 -mt-1 text-[11px] text-white/35">{bar.note}</span>
            ) : null}
          </div>
        ))}
      </div>
    </figure>
  );
}

export function ArticleBlocks({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h2":
            return (
              <h2
                key={i}
                className="pt-4 font-display text-xl tracking-[-0.02em] text-white sm:text-2xl"
              >
                {b.text}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="pt-2 font-display text-base tracking-[-0.01em] text-white">
                {b.text}
              </h3>
            );
          case "ul":
            return (
              <ul
                key={i}
                className="list-disc space-y-2 pl-5 text-base leading-relaxed text-white/65"
              >
                {b.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol
                key={i}
                className="list-decimal space-y-2 pl-5 text-base leading-relaxed text-white/65"
              >
                {b.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            );
          case "image":
            return (
              <figure key={i} className="home-media-frame overflow-hidden">
                <img src={b.src} alt={b.alt} className="w-full object-cover" />
                {b.caption ? (
                  <figcaption className="px-4 py-3 text-[13px] text-white/40">
                    {b.caption}
                  </figcaption>
                ) : null}
              </figure>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-2xl border border-white/[0.08]">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      {b.head.map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-white/40"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-white/[0.05] last:border-0">
                        {row.map((cell, c) => (
                          <td key={c} className="px-4 py-3 text-white/65 tabular-nums">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/40 p-4 font-mono text-[12.5px] leading-relaxed text-white/70"
              >
                <code>{b.code}</code>
              </pre>
            );
          case "note":
            return (
              <p
                key={i}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4 text-[15px] leading-relaxed text-white/55"
              >
                {b.text}
              </p>
            );
          case "chart":
            return <BarChart key={i} title={b.title} unit={b.unit} bars={b.bars} />;
          case "diagram": {
            const svg = DIAGRAMS[b.id];
            if (!svg) return null;
            return (
              <figure
                key={i}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6"
              >
                {svg}
                {b.caption ? (
                  <figcaption className="mt-4 text-[13px] text-white/40">{b.caption}</figcaption>
                ) : null}
              </figure>
            );
          }
          default:
            return (
              <p key={i} className="text-base leading-relaxed text-white/65">
                {b.text}
              </p>
            );
        }
      })}
    </>
  );
}
