/**
 * Copy for Streamdown's code blocks, Mermaid sources and tables, as the shared
 * CopyButton (DESIGN.md, Copy button). Streamdown's own copy controls write
 * with the browser clipboard API, which the Desktop App's renderer may not use.
 */
import { CopyButton } from "@polaris/ui";
import { type ComponentProps, useRef } from "react";
import {
  type Components,
  defaultComponents,
  type ExtraProps,
  extractTableDataFromElement,
  tableDataToMarkdown,
} from "streamdown";

type Hast = NonNullable<ExtraProps["node"]>;

/** The text under a hast node, as the fence holds it. */
const textOf = (node: Hast | Hast["children"][number] | undefined): string => {
  if (node === undefined) return "";

  if (node.type === "text") return node.value;

  return "children" in node ? node.children.map(textOf).join("") : "";
};

const Code = defaultComponents.code;

const Table = defaultComponents.table;

const CORNER = "absolute top-0.5 right-1 z-10";

/** Fenced code and Mermaid sources; pair with `copy: false` in Streamdown's code controls. */
export const COPY_CODE: Components = {
  // Only fenced code carries `data-block`; inline code stays as Streamdown draws it.
  code: (props) =>
    "data-block" in props ? (
      <div className="relative" data-copy="code">
        <Code {...props} />
        <CopyButton
          variant="icon"
          label="Copy code"
          text={() => textOf(props.node).replace(/\n$/, "")}
          className={CORNER}
        />
      </div>
    ) : (
      <Code {...props} />
    ),
};

/** Tables, as Markdown; pair with `copy: false` in Streamdown's table controls. */
export const COPY_TABLE: Components = { table: (props) => <CopyTable {...props} /> };

/** A table copies as Markdown, read from what is rendered. */
const CopyTable = (props: ComponentProps<typeof Table>) => {
  const root = useRef<HTMLDivElement>(null);

  const markdown = () => {
    const table = root.current?.querySelector("table");

    return table == null ? "" : tableDataToMarkdown(extractTableDataFromElement(table));
  };

  return (
    <div ref={root} className="relative" data-copy="table">
      <Table {...props} />
      <CopyButton variant="icon" label="Copy table" text={markdown} className={CORNER} />
    </div>
  );
};
