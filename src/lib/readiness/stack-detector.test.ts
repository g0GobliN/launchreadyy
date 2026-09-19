import { describe, expect, it } from "vitest";
import { detectStack } from "./stack-detector";

describe("detectStack — profile label", () => {
  it.each([
    ["Python", "Python service"],
    ["Go", "Go service"],
    ["Rust", "Rust service"],
    ["Ruby", "Ruby app"],
    ["PHP", "PHP app"],
    ["Java", "Java service"],
    ["Kotlin", "Kotlin service"],
    ["C#", ".NET service"],
    ["Elixir", "Elixir app"],
  ])(
    // A Python repo used to be labelled "General Node" in the report header — a confident,
    // wrong sentence about the reader's own project, on the first screen they see.
    "names the language for a %s repo instead of calling it Node",
    (framework, expected) => {
      expect(detectStack({}, ["main.py"], framework).profile).toBe(expected);
    },
  );

  it.each([
    [{ next: "15", stripe: "17" }, "Next.js + Stripe"],
    [{ next: "15" }, "Next.js App"],
    [{ express: "4" }, "Express API"],
    [{ react: "19" }, "React SPA"],
  ])("keeps the Node profiles it already had", (deps, expected) => {
    expect(detectStack(deps, ["package.json"], "unknown").profile).toBe(expected);
  });

  it("falls back to General Node only when a Node manifest had no framework in it", () => {
    expect(detectStack({ lodash: "4" }, ["package.json"], "unknown").profile).toBe("General Node");
  });
});
