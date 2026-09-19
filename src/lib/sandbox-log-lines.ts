export type LogLineType = "info" | "success" | "error" | "warning" | "command" | "output";

export type LogLine = {
  id: string;
  timestamp: string;
  type: LogLineType;
  message: string;
  step?: string;
};

/** Turn a cumulative live_log blob into typed lines for TerminalWindow. */
export function parseLiveLogLines(liveLog: string): LogLine[] {
  if (!liveLog.trim()) return [];
  const now = new Date();
  return liveLog.split("\n").map((raw, i) => {
    const message = raw.replace(/\r$/, "");
    const type = classifyLine(message);
    const ts = new Date(now.getTime() - Math.max(0, liveLog.split("\n").length - i) * 50);
    return {
      id: `line-${i}`,
      timestamp: ts.toISOString().slice(11, 19),
      type,
      message,
    };
  });
}

function classifyLine(message: string): LogLineType {
  const m = message.toLowerCase();
  // Keyword checks run against the line minus its path/filename tokens. A bundler's
  // size table ("dist/assets/auth-error-screen-B3Dd.js  2.21 kB") is plain output, but
  // matching "error"/"success" inside those names painted half a clean build red.
  const words = stripPathTokens(m);
  // "✖ 3 problems (0 errors, 3 warnings)" is eslint's summary for a *passing* run —
  // it carries the failure glyph and the word "errors" while nothing actually broke.
  if (/\b0 errors?\b/.test(words)) return /warn/.test(words) ? "warning" : "success";
  if (/error|failed|✗|✖/.test(words) || /exit code [1-9]/.test(m)) return "error";
  if (/warn(ing)?|⚡/.test(words)) return "warning";
  if (/✓|✔|passed|success/.test(words)) return "success";
  if (/^\$\s|^>\s|npm (ci|install|run)|pnpm |yarn |bun /.test(m)) return "command";
  if (/^───|^===/.test(message)) return "info";
  return "output";
}

/** Blank out tokens that look like a path, filename, or hashed asset name. */
function stripPathTokens(message: string): string {
  return message.replace(/\S*[/\\.]\S*/g, " ");
}
