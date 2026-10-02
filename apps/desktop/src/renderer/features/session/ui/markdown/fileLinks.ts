/**
 * A rehype step that turns `path:line` in assistant prose into links the `a` component opens in
 * the editor (`data-editor-*`), and inline code holding just a `path:line` too. Code blocks,
 * existing links and KaTeX are left alone. Runs after sanitizing, so its attributes stay.
 */
import { Option, Schema } from "effect";
import { type FoundLocation, findLocations, wholeLocation } from "../../../editor-links/index.ts";
import type { Node } from "./softBreaks.ts";

/** A hast property value, as rehype keeps them. */
type PropertyValue = string | number | boolean | ReadonlyArray<string | number> | null | undefined;

export interface Element {
  readonly type: "element";
  readonly tagName: string;
  readonly properties?: Readonly<Record<string, PropertyValue>>;
  children: Array<Node>;
}

const EditorLink = Schema.Struct({
  dataEditorPath: Schema.String,
  dataEditorLine: Schema.NumberFromString,
  dataEditorColumn: Schema.optionalKey(Schema.NumberFromString),
});

const decodeLink = Schema.decodeUnknownOption(EditorLink);

export interface EditorLinkTarget {
  readonly path: string;
  readonly line: number;
  readonly column: number | null;
}

/** The location a link made here points at, from its element's properties; null for other links. */
export const editorLinkOf = (
  properties: Readonly<Record<string, PropertyValue>> | undefined
): EditorLinkTarget | null =>
  Option.match(decodeLink(properties), {
    onNone: () => null,
    onSome: (link) => ({
      path: link.dataEditorPath,
      line: link.dataEditorLine,
      column: link.dataEditorColumn ?? null,
    }),
  });

const SKIP = new Set(["pre", "a", "svg", "math", "script", "style"]);

const isElement = (node: Node): node is Element => node.type === "element";

const textOf = (node: Node): string =>
  node.type === "text" && "value" in node
    ? node.value
    : "children" in node && Array.isArray(node.children)
      ? node.children.map(textOf).join("")
      : "";

const propertiesOf = (found: FoundLocation): Readonly<Record<string, PropertyValue>> => {
  const base = { href: "#", dataEditorPath: found.path, dataEditorLine: String(found.line) };

  return found.column === null ? base : { ...base, dataEditorColumn: String(found.column) };
};

const link = (found: FoundLocation, children: Array<Node>): Element => ({
  type: "element",
  tagName: "a",
  properties: propertiesOf(found),
  children,
});

const linked = (value: string): ReadonlyArray<Node> => {
  const found = findLocations(value);

  if (found.length === 0) return [{ type: "text", value }];
  const out: Array<Node> = [];
  let at = 0;

  for (const location of found) {
    if (location.start > at) out.push({ type: "text", value: value.slice(at, location.start) });
    out.push(link(location, [{ type: "text", value: value.slice(location.start, location.end) }]));
    at = location.end;
  }

  if (at < value.length) out.push({ type: "text", value: value.slice(at) });

  return out;
};

const isKatex = (node: Element) =>
  Array.isArray(node.properties?.["className"]) && node.properties["className"].includes("katex");

const rewrite = (node: Node): ReadonlyArray<Node> => {
  if (node.type === "text" && "value" in node) return linked(node.value);

  if (!isElement(node)) return [node];

  if (node.tagName === "code") {
    const whole = wholeLocation(textOf(node));

    return whole === null ? [node] : [link(whole, [node])];
  }

  if (SKIP.has(node.tagName) || isKatex(node)) return [node];
  node.children = node.children.flatMap(rewrite);

  return [node];
};

/** The unified plugin: `rehypePlugins={[…, rehypeFileLinks]}`. */
export const rehypeFileLinks = () => (tree: Node) => {
  if ("children" in tree && Array.isArray(tree.children))
    tree.children = tree.children.flatMap(rewrite);
};
