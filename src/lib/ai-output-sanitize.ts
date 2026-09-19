/** Strips a leading/trailing markdown code fence the model added despite being told not to. */
export function stripCodeFence(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-z0-9]*\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  return t;
}

/**
 * Strips a leading line where the model echoed the requested output path back (a real DeepSeek
 * response opened with `.github/workflows/ci.yml` followed by a fenced YAML block — the prefix
 * line kept stripCodeFence from seeing the fence at the start, so the "no fences" cleanup
 * removed only the closing fence and shipped a file that isn't valid YAML at all). Must run
 * BEFORE stripCodeFence so the fence ends up at the start where that function looks for it.
 */
export function stripEchoedOutputPath(text: string, outputPath: string): string {
  const t = text.trimStart();
  const newline = t.indexOf("\n");
  if (newline === -1) return text;
  const firstLine = t.slice(0, newline).trim();
  const normalized = firstLine.replace(/^output path:\s*/i, "").replace(/^[`#*\s]+|[`:*\s]+$/g, "");
  return normalized === outputPath ? t.slice(newline + 1) : text;
}
