import { useCallback, useState } from "react";
import { saveRepoBuildSettingsFn, type getRepoBuildSettingsFn } from "@/lib/api/sandbox.functions";

export type BuildData = Awaited<ReturnType<typeof getRepoBuildSettingsFn>>;

/**
 * Form state lives in a hook so the launch flow can save these values as part of
 * "Start sandbox" — typing a root directory and then launching has to apply it,
 * not silently run the old configuration because a separate Save was never clicked.
 *
 * Lives in `hooks/` rather than in BuildSettingsCard: a module exporting both a
 * component and a hook defeats Fast Refresh, so the hook is imported by the card
 * and by the env route from here instead.
 */
export function useBuildSettingsForm(initial: BuildData) {
  const [rootDir, setRootDir] = useState(initial.settings.rootDir ?? "");
  const [buildCommand, setBuildCommand] = useState(initial.settings.buildCommand ?? "");
  const [nodeVersion, setNodeVersion] = useState(initial.settings.nodeVersion ?? "");
  const [includeTest, setIncludeTest] = useState(initial.settings.includeTest);

  const changed =
    rootDir.trim() !== (initial.settings.rootDir ?? "") ||
    buildCommand.trim() !== (initial.settings.buildCommand ?? "") ||
    nodeVersion.trim() !== (initial.settings.nodeVersion ?? "") ||
    includeTest !== initial.settings.includeTest;

  const save = useCallback(
    async (repoId: string) => {
      await saveRepoBuildSettingsFn({
        data: {
          repoId,
          rootDir: rootDir.trim() || null,
          buildCommand: buildCommand.trim() || null,
          nodeVersion: nodeVersion.trim() || null,
          includeTest,
        },
      });
    },
    [rootDir, buildCommand, nodeVersion, includeTest],
  );

  /** No-op when nothing was touched — keeps the launch path off a needless write. */
  const saveIfChanged = useCallback(
    async (repoId: string) => {
      if (changed) await save(repoId);
    },
    [changed, save],
  );

  return {
    rootDir,
    setRootDir,
    buildCommand,
    setBuildCommand,
    nodeVersion,
    setNodeVersion,
    includeTest,
    setIncludeTest,
    changed,
    save,
    saveIfChanged,
  };
}

export type BuildSettingsForm = ReturnType<typeof useBuildSettingsForm>;
