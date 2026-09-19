import { format } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ScoreTrendPoint = { score: number; createdAt: string };

const LINE = "var(--data)";

/**
 * Readiness score over the last N scans.
 *
 * The y-axis is pinned to 0–100 rather than fitted to the data: the score *is* a percentage, and
 * letting the axis auto-fit would turn a two-point drift into a cliff.
 */
export function ScoreTrendCard({ history }: { history: ScoreTrendPoint[] }) {
  const points = history.map((p) => ({
    score: p.score,
    label: format(new Date(p.createdAt), "MMM d"),
    at: format(new Date(p.createdAt), "MMM d, h:mm a"),
  }));
  const last = points.length - 1;

  return (
    <section className="flex flex-col rounded-[5px] border border-border bg-card p-5 md:col-span-2 xl:col-span-1">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Score trend
      </h2>

      {points.length < 2 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          One scan so far. The trend appears once this repository has been scanned again — daily
          monitoring will fill it in on its own.
        </p>
      ) : (
        <div className="mt-4 h-[150px] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border)" }}
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 5,
                  fontSize: 12,
                }}
                itemStyle={{ color: "var(--color-card-foreground)" }}
                labelStyle={{ color: "var(--color-muted-foreground)" }}
                labelFormatter={(_l, payload) => payload?.[0]?.payload?.at ?? ""}
                formatter={(value: number) => [`${value} / 100`, "Readiness"]}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={LINE}
                strokeWidth={2}
                isAnimationActive={false}
                // Only the latest scan gets a marker — a dot on every point turns a trend into noise.
                dot={(props) => {
                  const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                  if (index !== last) return <g key={index} />;
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={LINE}
                      stroke="var(--color-card)"
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
