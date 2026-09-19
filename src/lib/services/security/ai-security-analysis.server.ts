import { aiService } from "../../../ai";
import type { Issue } from "../../mock-data";

export interface SecurityExplanation {
  whatIsWrong: string;
  whyItMatters: string;
  realisticScenario: string;
  severityAssessment: string;
  confidenceNote: string | null;
  howToFix: string;
  suggestedCodeChange?: string;
  prGenerationPossible: boolean;
}

/**
 * AI explains an existing security finding — never invents new ones.
 * AI-assisted; the issue records an effort estimate for the caller.
 */
export async function explainSecurityFinding(
  issue: Issue,
  opts?: { repoUrl?: string },
): Promise<SecurityExplanation> {
  const prompt = `You are helping a developer understand a Production Security finding from a launch-readiness scan.

Rules:
- Developer-friendly, concrete, actionable
- No scare tactics, no "hackers WILL steal"
- No exploit payloads, bypass techniques, or offensive guidance
- If confidence is medium/low, say what to verify manually

Finding:
- Title: ${issue.title}
- Severity: ${issue.severity}
- Confidence: ${issue.confidence ?? "unknown"}
- Why: ${issue.why}
- Evidence: ${issue.foundEvidence ?? issue.checkedFor?.join(", ") ?? "n/a"}
- Recommended fix: ${issue.recommendedFix ?? "n/a"}

Respond as JSON only:
{
  "whatIsWrong": "...",
  "whyItMatters": "...",
  "realisticScenario": "...",
  "severityAssessment": "...",
  "confidenceNote": "..." | null,
  "howToFix": "...",
  "suggestedCodeChange": "..." | omit,
  "prGenerationPossible": true|false
}`;

  const text = await aiService.generate(prompt, {
    taskType: "security_explanation",
    maxTokens: 1024,
    repoUrl: opts?.repoUrl,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      whatIsWrong: issue.title,
      whyItMatters: issue.why,
      realisticScenario: "Review the evidence and apply the recommended fix before launch.",
      severityAssessment: issue.severity,
      confidenceNote:
        issue.confidence && issue.confidence !== "high"
          ? "Verify this finding manually before treating it as a launch blocker."
          : null,
      howToFix: issue.recommendedFix ?? "Follow the recommended remediation for this finding.",
      prGenerationPossible: Boolean(issue.fixId && issue.autoFixable),
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as SecurityExplanation;
  return parsed;
}
