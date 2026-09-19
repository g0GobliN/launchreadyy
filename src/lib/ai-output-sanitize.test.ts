import { describe, expect, it } from "vitest";
import { stripCodeFence, stripEchoedOutputPath } from "./ai-output-sanitize";

describe("stripEchoedOutputPath", () => {
  const CI_PATH = ".github/workflows/ci.yml";

  // Exact shape of a real DeepSeek response for ci-ai's LLM path (static-site repo, 2026-07-11):
  // the model echoed the prompt's "Output path:" value as a bare first line, then fenced the
  // YAML. The prefix line hid the fence from stripCodeFence's start-anchored regex, so only the
  // closing fence was stripped and the shipped file opened with a stray path + ```yaml line.
  it("strips a bare echoed path line so the fence lands where stripCodeFence looks", () => {
    const raw = `${CI_PATH}\n\`\`\`yaml\nname: CI\non: push\n\`\`\``;
    expect(stripCodeFence(stripEchoedOutputPath(raw, CI_PATH))).toBe("name: CI\non: push");
  });

  it("strips an 'Output path:'-prefixed echo line", () => {
    const raw = `Output path: ${CI_PATH}\nname: CI\n`;
    expect(stripEchoedOutputPath(raw, CI_PATH)).toBe("name: CI\n");
  });

  it("strips a backticked/heading-decorated echo line", () => {
    expect(stripEchoedOutputPath(`\`${CI_PATH}\`\nname: CI\n`, CI_PATH)).toBe("name: CI\n");
    expect(stripEchoedOutputPath(`# ${CI_PATH}:\nname: CI\n`, CI_PATH)).toBe("name: CI\n");
  });

  it("leaves output alone when the first line is real content", () => {
    const clean = "name: CI\non: push\n";
    expect(stripEchoedOutputPath(clean, CI_PATH)).toBe(clean);
  });

  it("leaves a different path alone (only the requested output path is an echo)", () => {
    const raw = `src/other.ts\nname: CI\n`;
    expect(stripEchoedOutputPath(raw, CI_PATH)).toBe(raw);
  });

  it("leaves single-line output alone", () => {
    expect(stripEchoedOutputPath(CI_PATH, CI_PATH)).toBe(CI_PATH);
  });
});
