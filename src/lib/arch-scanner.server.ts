import { aiService } from "../ai";
import { ARCH_SCAN_UNSUPPORTED_MESSAGE, isArchScanSupported } from "./project-context";
import { GitHubFileProvider } from "./scan-engine/github-file-provider";
import { runArchScanCore, type ArchFinding, type ArchScanResult } from "./scan-engine/arch-scan";

export { ARCH_SCAN_UNSUPPORTED_MESSAGE, isArchScanSupported };
export type { ArchFinding, ArchScanResult };

async function addAiExplanations(findings: ArchFinding[]): Promise<void> {
  const complex = findings.filter(
    (f) => f.type === "circular-dep" || f.type === "separation-issue",
  );
  if (complex.length === 0) return;

  const items = complex
    .map(
      (f, i) =>
        `${i + 1}. [${f.type}] ${f.title}\nFiles: ${f.files.join(", ")}\nDetail: ${f.detail}`,
    )
    .join("\n\n");

  const text = await aiService.analyze(
    `You are a senior software architect reviewing a codebase. Explain each finding below in 1-2 sentences: what the problem is and the simplest fix. Be concrete and actionable. Number your answers to match the input.\n\n${items}`,
    { taskType: "architecture_analysis", maxTokens: 1024 },
  );
  const answers = text.split(/\n(?=\d+\.)/).map((s) => s.replace(/^\d+\.\s*/, "").trim());
  complex.forEach((f, i) => {
    if (answers[i]) f.aiExplanation = answers[i];
  });
}

export async function runArchScan(
  token: string,
  fullName: string,
  defaultBranch: string,
): Promise<ArchScanResult> {
  const provider = new GitHubFileProvider(token, fullName, defaultBranch);
  const result = await runArchScanCore(provider);
  await addAiExplanations(result.findings).catch(() => {});
  return result;
}
