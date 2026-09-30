/**
 * A rehype step that puts a `<wbr>` every 64 characters inside long unbroken
 * runs of prose and inline code, as `softWrap` does for plain text (a 6 KB
 * run lays out in ~25 ms without the breaks, ~1 ms with them). Code blocks
 * scroll instead, and KaTeX's output is left alone.
 */
import { softBreaks } from "../softWrap.tsx";

interface Text {
  readonly type: "text";
  readonly value: string;
}

interface Element {
  readonly type: "element";
  readonly tagName: string;
  readonly properties?: { readonly className?: unknown };
  children: Array<Node>;
}

interface Other {
  readonly type: string;
  children?: Array<Node>;
}

export type Node = Text | Element | Other;

const isElement = (node: Node): node is Element => node.type === "element";

const isText = (node: Node): node is Text => node.type === "text";

const SKIP = new Set(["pre", "svg", "math", "script", "style"]);

const skipped = (node: Element) =>
  SKIP.has(node.tagName) ||
  (Array.isArray(node.properties?.className) && node.properties.className.includes("katex"));

const wbr = (): Element => ({ type: "element", tagName: "wbr", children: [] });

const split = (node: Node): ReadonlyArray<Node> => {
  if (!isText(node)) return [node];
  const pieces = softBreaks(node.value);

  if (pieces.length === 1) return [node];

  return pieces.flatMap((value, n): Array<Node> => [
    ...(n > 0 ? [wbr()] : []),
    { type: "text", value },
  ]);
};

const walk = (node: Node) => {
  if (isText(node) || (isElement(node) && skipped(node))) return;
  const parent: Element | Other = node;

  if (parent.children === undefined) return;
  parent.children = parent.children.flatMap(split);

  for (const child of parent.children) walk(child);
};

/** The unified plugin: `rehypePlugins={[…, rehypeSoftBreaks]}`. */
export const rehypeSoftBreaks = () => (tree: Node) => {
  walk(tree);
};
