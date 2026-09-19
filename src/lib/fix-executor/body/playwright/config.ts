import {
  buildPlaywrightConfig,
  type PlaywrightConfigInput,
  pickPlaywrightConfigPaths,
} from "../../../playwright-config";
import { type ProjectContext } from "../../../project-context.server";
import { fetchFileContent } from "../../github";
import { detectRepoStack } from "../../../language-setup";

export const DEFAULT_PLAYWRIGHT_CONFIG = buildPlaywrightConfig();

export async function loadPlaywrightConfigInputs(
  token: string,
  fullName: string,
  ctx: ProjectContext,
  extraScripts: Record<string, string> = {},
): Promise<PlaywrightConfigInput> {
  const configPaths = pickPlaywrightConfigPaths(ctx.filePaths);
  const configFiles: Record<string, string> = {};
  await Promise.all(
    configPaths.map(async (p) => {
      const content = await fetchFileContent(token, fullName, p);
      if (content) configFiles[p] = content;
    }),
  );
  const envExample = await fetchFileContent(token, fullName, ".env.example");
  return {
    packageManager: ctx.packageManager,
    framework: ctx.resolvedFramework,
    language: ctx.language,
    isNodeProject: ctx.isNodeProject,
    stack: detectRepoStack(ctx.filePaths, ctx.resolvedFramework, ctx.manifests),
    manifests: ctx.manifests,
    scripts: { ...ctx.pkg.scripts, ...extraScripts },
    filePaths: ctx.filePaths,
    configFiles,
    envExample: envExample ?? undefined,
    mergedDeps: ctx.mergedDeps,
  };
}
