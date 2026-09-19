import { createHash } from "crypto";
import { fetchFileContent } from "../../../github";
import { findDirectoryBuildPropsPath, dotnetSdkVersion } from "../../../../project-context.server";

export function csharpEntryDllName(filePaths: string[]): string | null {
  const csproj = filePaths.find((p) => /\.csproj$/i.test(p) && !/test/i.test(p));
  if (!csproj) return null;
  return `${csproj
    .split("/")
    .pop()!
    .replace(/\.csproj$/i, "")}.dll`;
}

export function buildXunitTestCsproj(sdkVersion: string, appCsprojRelPath: string): string {
  const winPath = appCsprojRelPath.replace(/\//g, "\\");
  return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net${sdkVersion}</TargetFramework>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\${winPath}" />
  </ItemGroup>

</Project>
`;
}

export function addProjectToSln(
  slnContent: string,
  projectName: string,
  projectRelPath: string,
): string | null {
  const winPath = projectRelPath.replace(/\//g, "\\");
  if (slnContent.includes(winPath) || slnContent.includes(`"${projectName}"`)) return slnContent;
  const eol = slnContent.includes("\r\n") ? "\r\n" : "\n";
  const globalMatch = slnContent.match(/^Global\r?$/m);
  if (!globalMatch || globalMatch.index === undefined) return null;

  const hash = createHash("sha1").update(projectRelPath).digest("hex").toUpperCase();
  const guid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;

  const entry = `Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "${projectName}", "${winPath}", "{${guid}}"${eol}EndProject${eol}`;
  let out = slnContent.slice(0, globalMatch.index) + entry + slnContent.slice(globalMatch.index);

  // Mirror the solution's own configurations for the new project, if the sections exist.
  const solutionConfigs: string[] = [];
  const configSection = out.match(
    /GlobalSection\(SolutionConfigurationPlatforms\)[^]*?EndGlobalSection/,
  );
  if (configSection) {
    for (const line of configSection[0].split("\n")) {
      const m = line.match(/^\s*([^=\s][^=]*?)\s*=\s*/);
      if (m && !m[1].startsWith("GlobalSection")) solutionConfigs.push(m[1]);
    }
  }
  const projSectionRe =
    /(GlobalSection\(ProjectConfigurationPlatforms\)[^]*?)(\r?\n\s*EndGlobalSection)/;
  const projSection = out.match(projSectionRe);
  if (projSection && solutionConfigs.length > 0) {
    const mappings = solutionConfigs
      .map(
        (c) => `${eol}\t\t{${guid}}.${c}.ActiveCfg = ${c}${eol}\t\t{${guid}}.${c}.Build.0 = ${c}`,
      )
      .join("");
    out = out.replace(projSectionRe, `$1${mappings}$2`);
  }
  return out;
}

export async function fetchCsprojContent(
  token: string,
  fullName: string,
  filePaths: string[],
): Promise<string> {
  const csprojPath = filePaths.find((p) => /\.csproj$/i.test(p) && !/test/i.test(p));
  if (!csprojPath) return "";
  const csprojContent = (await fetchFileContent(token, fullName, csprojPath)) || "";
  const propsPath = findDirectoryBuildPropsPath(csprojPath, filePaths);
  const propsContent = propsPath ? (await fetchFileContent(token, fullName, propsPath)) || "" : "";
  return csprojContent + "\n" + propsContent;
}

export function dockerfileCsharp(filePaths: string[], csprojContent = ""): string {
  const dll = csharpEntryDllName(filePaths);
  const startCmd = dll
    ? `["dotnet", "${dll}"]`
    : '["sh", "-c", "dotnet $(ls *.dll | grep -vi test | head -n 1)"]';
  const sdk = dotnetSdkVersion(csprojContent);
  return `FROM mcr.microsoft.com/dotnet/sdk:${sdk}-alpine AS build
WORKDIR /app
COPY . .
RUN dotnet restore
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:${sdk}-alpine AS runner
WORKDIR /app
RUN (getent group app || addgroup -S app) && (getent passwd app || adduser -S app -G app)
COPY --from=build /out .
USER app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:8080/health || exit 1
CMD ${startCmd}
`;
}
