import { describe, expect, test } from "bun:test";
import { editorLinkOf, type Element, rehypeFileLinks } from "./fileLinks.ts";
import type { Node } from "./softBreaks.ts";

const text = (value: string): Node => ({ type: "text", value });

const el = (tagName: string, children: Array<Node>): Element => ({
  type: "element",
  tagName,
  properties: {},
  children,
});

const anchor = (
  properties: NonNullable<Element["properties"]>,
  children: Array<Node>
): Element => ({
  type: "element",
  tagName: "a",
  properties,
  children,
});

const run = (tree: Node): Node => {
  rehypeFileLinks()(tree);

  return tree;
};

describe("rehypeFileLinks", () => {
  test("links path:line in prose, keeping the text around it", () => {
    expect(run(el("root", [el("p", [text("see src/a.ts:12 now")])]))).toEqual(
      el("root", [
        el("p", [
          text("see "),
          anchor({ href: "#", dataEditorPath: "src/a.ts", dataEditorLine: "12" }, [
            text("src/a.ts:12"),
          ]),
          text(" now"),
        ]),
      ])
    );
  });

  test("inline code holding just a location becomes a link around it", () => {
    const tree = run(el("root", [el("p", [el("code", [text("log.ts:3:4")])])]));

    expect(tree).toMatchObject({
      children: [
        {
          children: [
            {
              tagName: "a",
              properties: { dataEditorPath: "log.ts", dataEditorLine: "3", dataEditorColumn: "4" },
              children: [{ tagName: "code" }],
            },
          ],
        },
      ],
    });
  });

  test("code blocks and links are left alone", () => {
    const tree = el("root", [el("pre", [el("code", [text("a.ts:1")])]), el("a", [text("b.ts:2")])]);

    expect(run(tree)).toEqual(
      el("root", [el("pre", [el("code", [text("a.ts:1")])]), el("a", [text("b.ts:2")])])
    );
  });
});

describe("editorLinkOf", () => {
  test("reads a link made here; other links are not", () => {
    expect(editorLinkOf({ dataEditorPath: "a.ts", dataEditorLine: "3" })).toEqual({
      path: "a.ts",
      line: 3,
      column: null,
    });
    expect(editorLinkOf({ href: "https://polaris.dev" })).toBeNull();
    expect(editorLinkOf(undefined)).toBeNull();
  });
});
