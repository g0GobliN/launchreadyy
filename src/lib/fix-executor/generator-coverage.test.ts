import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_FIX_TOOL_IDS, FIX_IDS_WITHOUT_GENERATOR } from "../fix-tool-catalog";

/**
 * Regression: `security-csrf` shipped registered in ALL_FIX_TOOL_IDS, reportable by
 * scanner/security/csrf.ts and bundled in the Security Pack — with no generator anywhere
 * in fix-executor/. Requesting it produced no file, no note and no warning, so the PR came back
 * missing the CSRF half while the pack still charged for it.
 *
 * Nothing tied the registry to the code that implements it, so the gap was invisible. This does.
 */
const BODY_DIR = path.join(__dirname, "body");

function sourceText(dir: string): string {
  let out = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out += sourceText(full);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
      out += fs.readFileSync(full, "utf8");
  }
  return out;
}

describe("fix generator coverage", () => {
  const body = sourceText(BODY_DIR);

  it.each(ALL_FIX_TOOL_IDS.filter((id) => !FIX_IDS_WITHOUT_GENERATOR.has(id)))(
    "%s is referenced by a generator in fix-executor/body",
    (fixId) => {
      expect(body).toContain(`"${fixId}"`);
    },
  );

  it("every id without a generator is a real fix id", () => {
    for (const id of FIX_IDS_WITHOUT_GENERATOR) {
      expect(ALL_FIX_TOOL_IDS).toContain(id);
    }
  });

  it("an id listed as having no generator really has none — remove it once implemented", () => {
    for (const id of FIX_IDS_WITHOUT_GENERATOR) {
      expect(
        body.includes(`"${id}"`),
        `"${id}" now appears in fix-executor/body — drop it from FIX_IDS_WITHOUT_GENERATOR`,
      ).toBe(false);
    }
  });
});
