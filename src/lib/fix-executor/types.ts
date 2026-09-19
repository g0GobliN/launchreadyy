import type { FileValidationResult } from "../fix-validation";
import type { DiffLineType } from "./pr";

export interface VerificationNote {
  fixId: string;
  status: "verified" | "warning";
  note: string;
  /**
   * Machine-readable cause, when there is one — currently the sandbox skip reason.
   *
   * The PR body needs the bare reason to compose its own sentence, and the first version of this
   * recovered it by running regexes over `note`. That coupled the body's rendering to the exact
   * prose of a message written in another module. Carrying the reason alongside the sentence
   * costs one optional field and removes the coupling. Optional because notes persisted before
   * this field existed are re-read from `pending_verification_notes` and must still parse.
   */
  reason?: string;
}

export interface CollectResult {
  files: { path: string; content: string }[];
  verificationNotes: VerificationNote[];
  preflight?: import("../fix-preflight.server").PreflightResult;
  previewInsight?: import("../fix-preview-insight.server").FixPreviewInsight;
}

export interface AiTestFile {
  fixId?: string;
  path: string;
  content: string;
}

export interface PreviewDiffLine {
  type: DiffLineType;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface PreviewFileDiff {
  path: string;
  status: "added" | "modified";
  lines: PreviewDiffLine[];
  validation: FileValidationResult;
}
