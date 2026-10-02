interface MarkdownNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  properties?: Record<string, string | number | boolean | ReadonlyArray<string | number>>;
  readonly children?: Array<MarkdownNode>;
}

const textOf = (node: MarkdownNode): string =>
  node.value ?? (node.children ?? []).map(textOf).join("");

/** Assign deterministic, preview-local heading anchors after HTML sanitization. */
export const previewHeadings =
  () =>
  (tree: MarkdownNode): void => {
    const counts = new Map<string, number>();

    const visit = (node: MarkdownNode): void => {
      if (/^h[1-6]$/.test(node.tagName ?? "")) {
        const base = textOf(node)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
          .replace(/\s/g, "-");

        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        node.properties = {
          ...node.properties,
          id: `preview-${base}${count ? `-${count}` : ""}`,
          tabIndex: -1,
        };
      }

      for (const child of node.children ?? []) visit(child);
    };

    visit(tree);
  };
