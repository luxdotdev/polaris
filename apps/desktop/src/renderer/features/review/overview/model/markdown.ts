/**
 * Review Markdown on top of Streamdown's GFM: GitHub alerts (`> [!WARNING]`), `diff` blocks
 * drawn like the diff viewer, long tables folded, and paths and findings as links into
 * Changes. A rehype step after sanitizing, so it only reshapes what is already safe.
 */

interface Text {
  readonly type: "text";
  value: string;
}

/** A hast property's value, as rehype gives it. */
export type PropValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number>;

export type Properties = Readonly<Record<string, PropValue>>;

export interface Element {
  readonly type: "element";
  tagName: string;
  properties: Properties;
  children: Array<Node>;
}

interface Other {
  readonly type: string;
  children?: Array<Node>;
}

export type Node = Text | Element | Other;

const isElement = (node: Node | undefined): node is Element => node?.type === "element";

const isText = (node: Node | undefined): node is Text => node?.type === "text";

export const childrenOf = (node: Node): Array<Node> | undefined =>
  isText(node) ? undefined : node.children;

const el = (tagName: string, properties: Properties, children: Array<Node>): Element => ({
  type: "element",
  tagName,
  properties,
  children,
});

const text = (value: string): Text => ({ type: "text", value });

export const textOf = (node: Node): string => {
  if (isText(node)) return node.value;

  return (childrenOf(node) ?? []).map(textOf).join("");
};

const classes = (node: Element): ReadonlyArray<string> => {
  const value = node.properties["className"];

  return Array.isArray(value) ? value.map(String) : [];
};

/** Finding links as the walkthrough writes them, `[title](finding:id)`, become hash links. */
export const prepareMarkdown = (markdown: string) =>
  markdown.replace(/\]\(finding:([^)\s]+)\)/g, "](#finding=$1)");

/** What an in-document link points at. */
export type ReviewLink =
  | { readonly kind: "finding"; readonly id: string }
  | { readonly kind: "path"; readonly path: string; readonly line: number | null }
  | { readonly kind: "external"; readonly href: string };

export const linkOf = (href: string): ReviewLink => {
  if (href.startsWith("#finding=")) return { kind: "finding", id: href.slice(9) };

  if (href.startsWith("#path=")) {
    const target = decodeURIComponent(href.slice(6));
    const match = /^(.*?):(\d+)$/.exec(target);

    return match === null
      ? { kind: "path", path: target, line: null }
      : { kind: "path", path: match[1] ?? target, line: Number(match[2]) };
  }

  return { kind: "external", href };
};

/** A changed path a reference names: the path itself, or a unique one it ends. */
export const resolvePath = (
  reference: string,
  paths: ReadonlyArray<string>
): { readonly path: string; readonly line: number | null } | null => {
  const match = /^(.+?)(?::(\d+))?$/.exec(reference.trim());
  const name = match?.[1]?.replace(/^\.?\//, "") ?? "";

  if (name === "" || !/[./]/.test(name)) return null;
  const line = match?.[2] === undefined ? null : Number(match[2]);

  if (paths.includes(name)) return { path: name, line };
  const ends = paths.filter((p) => p.endsWith(`/${name}`));

  return ends.length === 1 && ends[0] !== undefined ? { path: ends[0], line } : null;
};

const pathHref = (target: { readonly path: string; readonly line: number | null }) =>
  `#path=${encodeURIComponent(target.line === null ? target.path : `${target.path}:${target.line}`)}`;

const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

const alertTitle = (kind: string) => `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;

const firstElement = (node: Element) => node.children.find(isElement);

/** `> [!WARNING]` → a `div[data-alert]` titled "Warning"; null when it isn't an alert. */
const alertOf = (node: Element): Element | null => {
  const paragraph = firstElement(node);
  const lead = paragraph?.children[0];

  if (paragraph?.tagName !== "p" || !isText(lead)) return null;
  const match = ALERT.exec(lead.value);

  if (match === null) return null;
  const kind = (match[1] ?? "note").toLowerCase();

  lead.value = lead.value.slice(match[0].length);

  if (
    lead.value === "" &&
    isElement(paragraph.children[1]) &&
    paragraph.children[1].tagName === "br"
  ) {
    paragraph.children.splice(1, 1);
  }

  return el("div", { className: ["md-alert"], dataAlert: kind }, [
    el("p", { className: ["md-alert-title"] }, [text(alertTitle(kind))]),
    ...node.children,
  ]);
};

const lineKind = (line: string) => {
  if (line.startsWith("+")) return "add";

  return line.startsWith("-") ? "del" : "ctx";
};

/** Splits a run of text into text and links for the changed paths it names. */
const linkifyText = (value: string, paths: ReadonlyArray<string>): Array<Node> => {
  const out: Array<Node> = [];
  let rest = "";

  for (const part of value.split(/(\s+)/)) {
    const target = /\S/.test(part) ? resolvePath(part, paths) : null;

    if (target === null) rest += part;
    else {
      if (rest !== "") out.push(text(rest));
      out.push(el("a", { href: pathHref(target), className: ["md-path"] }, [text(part)]));
      rest = "";
    }
  }

  if (rest !== "") out.push(text(rest));

  return out;
};

/** A fenced block as lines: `diff` ones with their add/remove fill, others plain with path links. */
const blockOf = (code: Element, paths: ReadonlyArray<string>): Element | null => {
  const language =
    classes(code)
      .find((c) => c.startsWith("language-"))
      ?.slice(9) ?? "";

  const diff = language === "diff";

  if (!diff && !["", "text", "tree", "txt", "plain"].includes(language)) return null;

  const lines = textOf(code).replace(/\n$/, "").split("\n");

  return el(
    "div",
    { className: ["md-block"], dataDiff: diff ? "" : undefined },
    lines.map((line) => {
      const kind = diff ? lineKind(line) : "ctx";
      const body = diff ? line.slice(1) : line;

      return el("div", { className: ["md-line"], dataLine: kind }, [
        ...(diff
          ? [
              el("span", { className: ["md-sign"] }, [
                text(kind === "ctx" ? " " : (line[0] ?? " ")),
              ]),
            ]
          : []),
        el("span", { className: ["md-code"] }, linkifyText(body === "" ? " " : body, paths)),
      ]);
    })
  );
};

/** Tables with more body rows than this fold into a `<details>`. */
export const LONG_TABLE_ROWS = 10;

const rowsOf = (table: Element) => {
  const body = table.children.find((c) => isElement(c) && c.tagName === "tbody");

  return isElement(body) ? body.children.filter(isElement).length : 0;
};

interface Context {
  readonly paths: ReadonlyArray<string>;
  readonly inDetails: boolean;
}

const previousElement = (children: Array<Node>, index: number) => {
  for (let i = index - 1; i >= 0; i -= 1) {
    const node = children[i];

    if (isElement(node)) return { node, index: i };

    if (!isText(node) || node.value.trim() !== "") return null;
  }

  return null;
};

/** A long table folded: a short paragraph just before it becomes the summary. */
const foldTable = (children: Array<Node>, index: number, table: Element) => {
  const node = children[index];
  const rows = rowsOf(table);
  const before = previousElement(children, index);

  const label =
    before !== null && before.node.tagName === "p" && textOf(before.node).length <= 60
      ? textOf(before.node).replace(/:\s*$/, "")
      : "Table";

  const summary = el("summary", {}, [text(`${label} · ${rows} rows`)]);

  if (node === undefined) return;

  children[index] = el("details", { className: ["md-long-table"] }, [summary, node]);

  if (label !== "Table" && before !== null) children.splice(before.index, 1);
};

const visitChild = (children: Array<Node>, index: number, ctx: Context) => {
  const node = children[index];

  if (!isElement(node)) return;

  if (node.tagName === "blockquote") {
    const alert = alertOf(node);

    if (alert !== null) children[index] = alert;
  }

  if (node.tagName === "pre") {
    const code = firstElement(node);
    const block = code?.tagName === "code" ? blockOf(code, ctx.paths) : null;

    if (block !== null) {
      children[index] = block;

      return;
    }
  }

  if (node.tagName === "code") {
    const target = resolvePath(textOf(node), ctx.paths);

    if (target !== null) {
      children[index] = el("a", { href: pathHref(target), className: ["md-path"] }, [node]);

      return;
    }
  }

  if (!ctx.inDetails && node.tagName === "table" && rowsOf(node) > LONG_TABLE_ROWS) {
    foldTable(children, index, node);

    return;
  }

  visit(children[index] ?? node, {
    ...ctx,
    inDetails: ctx.inDetails || node.tagName === "details",
  });
};

const visit = (node: Node, ctx: Context) => {
  if (isElement(node) && (node.tagName === "pre" || node.tagName === "a")) return;
  const children = childrenOf(node);

  if (children === undefined) return;

  // Folding a table may remove the paragraph before it, so walk from the end.
  for (let i = children.length - 1; i >= 0; i -= 1) visitChild(children, i, ctx);
};

/** The rehype step for one Review's changed paths. */
export const rehypeReview = (paths: ReadonlyArray<string>) => () => (tree: Node) =>
  visit(tree, { paths, inDetails: false });
