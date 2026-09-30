import { describe, expect, test } from "bun:test";
import { type Node, rehypeSoftBreaks } from "./softBreaks.ts";

const text = (value: string): Node => ({ type: "text", value });

const el = (tagName: string, children: Array<Node>, className?: Array<string>): Node => ({
  type: "element",
  tagName,
  properties: className === undefined ? {} : { className },
  children,
});

const run = (tree: Node): Node => {
  rehypeSoftBreaks()(tree);

  return tree;
};

/** Each child as its text length, or its tag. */
const childPieces = (node: Node | undefined): ReadonlyArray<string | number> =>
  node !== undefined && "children" in node && node.children !== undefined
    ? node.children.map((c) =>
        "value" in c ? c.value.length : "tagName" in c ? c.tagName : c.type
      )
    : [];

describe("soft breaks in Markdown", () => {
  test("a long run in prose gets a <wbr> every 64 characters", () => {
    const p = el("p", [text("y".repeat(130))]);

    run({ type: "root", children: [p] });
    expect(childPieces(p)).toEqual([64, "wbr", 64, "wbr", 2]);
  });

  test("code blocks and KaTeX are left alone", () => {
    const long = "y".repeat(130);
    const pre = el("pre", [el("code", [text(long)])]);
    const math = el("span", [text(long)], ["katex"]);

    expect(run({ type: "root", children: [pre, math] })).toEqual({
      type: "root",
      children: [pre, math],
    });
  });
});
