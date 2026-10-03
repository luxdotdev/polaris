import { markdownLanguage } from "@codemirror/lang-markdown";
import type { EditorState } from "@codemirror/state";

/** Reveal a Markdown link's heading in source using the same local slug convention as preview. */
export const sourceHeadingLine = (state: EditorState, fragment: string): number | null => {
  const text = state.sliceDoc();
  const tree = markdownLanguage.parser.parse(text);
  const counts = new Map<string, number>();
  let line: number | null = null;
  tree.iterate({
    enter(node) {
      if (!/^(ATX|Setext)Heading[1-6]$/.test(node.name)) return;

      const title = text
        .slice(node.from, node.to)
        .replace(/^#+\s+|\s+#+\s*$|\n[=-]+\s*$/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*`~]|<[^>]*>/g, "");

      const base = title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
        .replace(/\s/g, "-");

      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      const slug = `${base}${count ? `-${count}` : ""}`;

      if (line === null && slug === fragment) line = state.doc.lineAt(node.from).number;
    },
  });

  return line;
};
