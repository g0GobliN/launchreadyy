import { auditorLanguageFromFramework, auditorSourceExt } from "../auditor-lang.server";

const AUDITOR_CENTRAL_SERVER_PATHS = ["server.ts", "server.js", "src/server.ts", "src/server.js"];

export function pickAuditorPaths(files: string[], framework: string, max = 35): string[] {
  const language = auditorLanguageFromFramework(framework);
  const ext = auditorSourceExt(language);
  const picked = files
    .filter((f) => ext.test(f) && !f.includes("node_modules") && !f.endsWith(".d.ts"))
    .filter((f) => !f.includes(".test.") && !f.includes(".spec.") && !f.includes("__tests__"))
    .sort((a, b) => {
      const score = (p: string) =>
        (p.includes("webhook") || p.includes("stripe") ? 0 : 5) +
        (p.includes("/api/") || p.includes("/routes/") || p.includes("/controller/") ? 1 : 5) +
        (p.includes("/app/") || p.includes("/pages/") || /Controller\.java$/.test(p) ? 2 : 5) +
        (/^(main|app)\.py$/.test(p) ? 0 : 5);
      return score(a) - score(b);
    })
    .slice(0, max);
  const central = AUDITOR_CENTRAL_SERVER_PATHS.filter((p) => files.includes(p));
  return [...new Set([...central, ...picked])];
}
