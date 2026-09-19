import type { AiTestFile, VerificationNote } from "../../types";
import type { PkgMods } from "../../github";
import type { ProjectContext } from "../../../project-context.server";
import type { analyzeProjectCi } from "../../../project-ci.server";
import type { detectPhpFramework, detectRustFramework } from "../../../backend-patch.server";

/** Options accepted by collectFixFiles — split out unchanged from the original inline type. */
export interface CollectFixFilesOpts {
  framework?: string;
  repoName?: string;
  aiFiles?: AiTestFile[];
  auditorTargetPaths?: Partial<Record<string, string>>;
}

/**
 * Shared closure state for collectFixFiles, threaded through every extracted case/wiring
 * handler. Every field here is exactly one of the local variables collectFixFiles used to
 * close over directly — this object exists only so the giant function's cases could be split
 * into separate files without changing what each case actually reads or mutates.
 */
export interface FixCtx {
  token: string;
  fullName: string;
  fixIds: string[];
  effectiveFixIds: string[];
  opts: CollectFixFilesOpts | undefined;
  framework: string;
  repoName: string;
  aiFiles: AiTestFile[] | undefined;
  fileMap: Map<string, string>;
  pkgMods: PkgMods;
  gitignoreAppends: string[];
  readmeSections: string[];
  verificationNotes: VerificationNote[];
  add: (path: string, content: string) => void;
  note: (fixId: string, status: "verified" | "warning", text: string) => void;
  ctx: ProjectContext;
  pkgMeta: ProjectContext["pkg"];
  pm: ProjectContext["packageManager"];
  repoFilePaths: string[];
  mergedDeps: ProjectContext["mergedDeps"];
  fw: ProjectContext["resolvedFramework"];
  javaBasePackage: string;
  javaApplicationPath: string | null;
  addJava: (sub: string, className: string, template: string) => void;
  kotlinBasePackage: string;
  kotlinApplicationPath: string | null;
  addKotlin: (sub: string, className: string, template: string) => void;
  ciProfileInput: () => ReturnType<typeof analyzeProjectCi>;
  buildCiYaml: (profile: ReturnType<typeof analyzeProjectCi>) => string;
  phpFw: ReturnType<typeof detectPhpFramework> | "unknown";
  rustFwHint: ReturnType<typeof detectRustFramework>;
  rustMiddlewareSrc: string;
  bundled: string[];
}
