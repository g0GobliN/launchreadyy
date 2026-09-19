import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

function textFiles(directory: string): string[] {
  return readdirSync(`${root}/${directory}`, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory()
      ? textFiles(path)
      : /\.(?:tsx?|md|txt|xml)$/.test(entry.name)
        ? [path]
        : [];
  });
}

it("keeps project links independent of the former hosted service", () => {
  const retiredDomains = ["xyz", "com"].map((suffix) => `launchreadyy.${suffix}`);
  const files = ["README.md", ...textFiles("src"), ...textFiles("docs"), ...textFiles("public")];
  const matches = files.filter((file) => {
    const source = readFileSync(`${root}/${file}`, "utf8");
    return retiredDomains.some((domain) => source.includes(domain));
  });
  expect(matches).toEqual([]);
});
