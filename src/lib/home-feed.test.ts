import { describe, expect, it } from "vitest";

import { articleBodyToBlocks } from "./home-feed";

describe("articleBodyToBlocks", () => {
  it("keeps headings, paragraphs and bullet lists working", () => {
    expect(
      articleBodyToBlocks("## Title\n\nSome prose\nwrapped over lines.\n\n- one\n- two"),
    ).toEqual([
      { type: "h2", text: "Title" },
      { type: "p", text: "Some prose wrapped over lines." },
      { type: "ul", items: ["one", "two"] },
    ]);
  });

  it("separates ordered from unordered lists instead of merging them", () => {
    expect(articleBodyToBlocks("- a\n1. b")).toEqual([
      { type: "ul", items: ["a"] },
      { type: "ol", items: ["b"] },
    ]);
  });

  it("parses a chart directive into typed bars, with unit split off the title", () => {
    const blocks = articleBodyToBlocks(
      ":::chart Accuracy by check (findings)\nci | 15 | no misses\ndockerfile | 17\n:::",
    );
    expect(blocks).toEqual([
      {
        type: "chart",
        title: "Accuracy by check",
        unit: "findings",
        bars: [
          { label: "ci", value: 15, note: "no misses" },
          { label: "dockerfile", value: 17 },
        ],
      },
    ]);
  });

  it("drops chart rows whose value is not a number", () => {
    const [chart] = articleBodyToBlocks(":::chart X\ngood | 3\nbad | n/a\n:::");
    expect(chart).toMatchObject({ bars: [{ label: "good", value: 3 }] });
  });

  it("strips the markdown separator row from tables", () => {
    expect(articleBodyToBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |")).toEqual([
      { type: "table", head: ["a", "b"], rows: [["1", "2"]] },
    ]);
  });

  it("captures code fences verbatim, without treating their contents as markdown", () => {
    const [code] = articleBodyToBlocks("```ts\n## not a heading\n- not a list\n```");
    expect(code).toEqual({ type: "code", lang: "ts", code: "## not a heading\n- not a list" });
  });

  it("reads images and diagrams with their captions", () => {
    expect(articleBodyToBlocks("![alt text](/x.jpg) A caption")).toEqual([
      { type: "image", alt: "alt text", src: "/x.jpg", caption: "A caption" },
    ]);
    expect(articleBodyToBlocks(":::diagram how-it-works\nThe flow.\n:::")).toEqual([
      { type: "diagram", id: "how-it-works", caption: "The flow." },
    ]);
  });

  it("ignores an unknown ::: directive rather than leaking its body as prose", () => {
    expect(articleBodyToBlocks(":::mystery\nhidden\n:::\n\nafter")).toEqual([
      { type: "p", text: "after" },
    ]);
  });
});
