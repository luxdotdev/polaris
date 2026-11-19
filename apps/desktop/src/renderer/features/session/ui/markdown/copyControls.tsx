/**
 * Copy for Markdown tables, as the shared CopyButton (DESIGN.md, Copy button), which writes
 * through the Desktop App's clipboard rather than the browser's. Code blocks carry their own
 * (`code/CodeBlock.tsx`).
 */
import { CopyButton } from "@polaris/ui";
import { type ComponentProps, useRef } from "react";
import type { Components } from "./words/Markup.tsx";

const cell = (element: Element) =>
  (element.textContent ?? "")
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

/** A rendered table as GitHub Markdown: its header row, a rule, then its body rows. */
export const tableMarkdown = (table: HTMLTableElement): string => {
  const rows = Array.from(table.rows, (row) => Array.from(row.cells, cell));
  const [head = [], ...body] = rows;
  const line = (cells: ReadonlyArray<string>) => `| ${cells.join(" | ")} |`;

  return [line(head), line(head.map(() => "---")), ...body.map(line)].join("\n");
};

/** A table copies as Markdown, read from what is rendered. */
const CopyTable = (props: ComponentProps<"table">) => {
  const root = useRef<HTMLDivElement>(null);

  const markdown = () => {
    const table = root.current?.querySelector("table");

    return table == null ? "" : tableMarkdown(table);
  };

  return (
    <div ref={root} className="relative" data-copy="table">
      <div data-md="table-wrapper">
        <table {...props} />
      </div>
      {/* Outside the scroller, so it stays at the corner; the last header cell leaves it room. */}
      <div data-md="table-copy">
        <CopyButton variant="icon" label="Copy table" text={markdown} />
      </div>
    </div>
  );
};

/** Tables, as Markdown. */
export const COPY_TABLE: Components = {
  table: ({ node: _node, ...props }: ComponentProps<"table"> & { readonly node?: unknown }) => (
    <CopyTable {...props} />
  ),
};
