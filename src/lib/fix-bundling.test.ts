import { describe, expect, it } from "vitest";
import {
  expandBundledFixIds,
  isBundledReadmeFix,
  isReadmeBundledWithEnvExample,
} from "./fix-bundling";

describe("fix bundling", () => {
  it("bundles readme with env-example when both issues exist", () => {
    const scan = ["env-example", "readme", "vitest"];
    expect(isReadmeBundledWithEnvExample(scan)).toBe(true);
    expect(expandBundledFixIds(["env-example"], scan)).toEqual(["env-example", "readme"]);
    expect(isBundledReadmeFix("readme", scan)).toBe(true);
  });

  it("bundles readme-ai with env-example-ai when both issues exist", () => {
    const scan = ["env-example-ai", "readme-ai", "ci-ai"];
    expect(isReadmeBundledWithEnvExample(scan)).toBe(true);
    expect(expandBundledFixIds(["env-example-ai"], scan)).toEqual(["env-example-ai", "readme-ai"]);
    expect(isBundledReadmeFix("readme-ai", scan)).toBe(true);
  });

  it("does not add readme when only env-example is missing", () => {
    const scan = ["env-example", "vitest"];
    expect(expandBundledFixIds(["env-example"], scan)).toEqual(["env-example"]);
  });
});
