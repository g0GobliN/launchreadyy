/** Standalone Next config — `.mjs` so Next 14 (no native next.config.ts) can load it. */
export const NEXT_CONFIG_STANDALONE = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
};

export default nextConfig;
`;

/** Filename used when creating a new standalone config (Next 14+ compatible). */
export const NEXT_CONFIG_STANDALONE_PATH = "next.config.mjs";

export function patchNextConfigStandalone(content: string): string | null {
  if (/output\s*:\s*["']standalone["']/.test(content)) return null;
  const insertAt = content.search(/(?:=\s*\{|export\s+default\s*\{)/);
  if (insertAt === -1) return null;
  const braceIdx = content.indexOf("{", insertAt);
  if (braceIdx === -1) return null;
  return content.slice(0, braceIdx + 1) + '\n  output: "standalone",' + content.slice(braceIdx + 1);
}
