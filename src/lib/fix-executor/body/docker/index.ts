import { type LanguageManifests } from "../../../project-context.server";
import { NodePm } from "../shared/types";
import { dockerfileNextjs, dockerfileVite, dockerfileNode } from "../node/docker";
import { dockerfilePython } from "../languages/python/docker";
import { dockerfileGo } from "../languages/go/docker";
import { dockerfileRuby } from "../languages/ruby/docker";
import { dockerfileRust } from "../languages/rust/docker";
import { dockerfileJava } from "../languages/java/docker";
import { dockerfileKotlin } from "../languages/kotlin/docker";
import { dockerfileCsharp } from "../languages/csharp/docker";
import { DOCKERFILE_ELIXIR } from "../languages/elixir/docker";
import { dockerfilePhp } from "../languages/php/docker";

export function dockerfile(
  framework: string,
  packageManager: NodePm = "npm",
  filePaths: string[] = [],
  manifests: Partial<LanguageManifests> = {},
  csprojContent = "",
  getContent?: (path: string) => string | undefined,
): string {
  if (framework === "Next.js") return dockerfileNextjs(packageManager);
  if (framework === "Vite" || framework === "React") return dockerfileVite(packageManager);
  if (framework === "Python")
    return dockerfilePython(
      filePaths,
      (manifests.requirements ?? "") + (manifests.pyprojectToml ?? ""),
      getContent,
    );
  if (framework === "Go") return dockerfileGo(filePaths);
  if (framework === "Ruby") return dockerfileRuby(filePaths, manifests.gemfile ?? "");
  if (framework === "Rust") return dockerfileRust(manifests.cargoToml ?? "", filePaths);
  if (framework === "Java") return dockerfileJava(manifests);
  if (framework === "Kotlin") return dockerfileKotlin(manifests);
  if (framework === "C#") return dockerfileCsharp(filePaths, csprojContent);
  if (framework === "Elixir") return DOCKERFILE_ELIXIR;
  if (framework === "PHP") return dockerfilePhp(filePaths);
  return dockerfileNode(packageManager); // Express / unknown → node server
}
