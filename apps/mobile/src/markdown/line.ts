/**
 * Blocks as one run of spans, a block per line, for places that show a message in a few lines
 * (the lead's note): emphasis and code keep their style, structure becomes markers and line breaks.
 */
import type { Block, Span, Spans } from "./model.ts";

const plain = (text: string): Span => ({ text, marks: [], href: null });

const strong = (spans: Spans): Spans =>
  spans.map((span) =>
    span.marks.includes("strong") ? span : { ...span, marks: [...span.marks, "strong" as const] }
  );

const joined = (lines: ReadonlyArray<Spans>, separator: string): Spans =>
  lines.flatMap((line, i) => (i === 0 ? line : [plain(separator), ...line]));

const cells = (row: ReadonlyArray<Spans>) => joined(row, " · ");

const linesOf = (block: Block): ReadonlyArray<Spans> => {
  switch (block.kind) {
    case "paragraph":
      return [block.spans];
    case "heading":
      return [strong(block.spans)];
    case "code":
      return [[{ text: block.text, marks: ["code"], href: null }]];
    case "quote":
      return block.blocks.flatMap(linesOf);
    case "list":
      return block.items.map((item) => [
        plain(`${item.checked === null ? item.marker : item.checked ? "✓" : "○"} `),
        ...joined(item.blocks.flatMap(linesOf), " "),
      ]);
    case "table":
      return [cells(block.header), ...block.rows.map(cells)];
    case "rule":
      return [];
  }
};

/** The blocks' text as one paragraph of spans, a line per block. */
export const lineOf = (blocks: ReadonlyArray<Block>): Spans =>
  joined(blocks.flatMap(linesOf), "\n");
