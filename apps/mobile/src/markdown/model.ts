/**
 * Markdown as the Mobile App draws it: blocks of styled spans, plain data with no React Native,
 * so the mapping from Markdown is tested on its own and the views stay a thin switch.
 */

export type Mark = "strong" | "em" | "del" | "code";

/** A run of text with one style; `href` is set only for a link the phone may open. */
export interface Span {
  readonly text: string;
  readonly marks: ReadonlyArray<Mark>;
  readonly href: string | null;
}

export type Spans = ReadonlyArray<Span>;

export interface ListItem {
  /** "•" or "◦" by depth, "3." for an ordered list. */
  readonly marker: string;
  /** A task list item's box; null for an ordinary item. */
  readonly checked: boolean | null;
  readonly blocks: ReadonlyArray<Block>;
}

export type Align = "left" | "center" | "right";

export type Block =
  | { readonly kind: "paragraph"; readonly spans: Spans }
  | { readonly kind: "heading"; readonly level: number; readonly spans: Spans }
  | { readonly kind: "code"; readonly lang: string; readonly text: string }
  | { readonly kind: "quote"; readonly blocks: ReadonlyArray<Block> }
  | { readonly kind: "list"; readonly items: ReadonlyArray<ListItem> }
  | {
      readonly kind: "table";
      readonly align: ReadonlyArray<Align>;
      readonly header: ReadonlyArray<Spans>;
      readonly rows: ReadonlyArray<ReadonlyArray<Spans>>;
      /** The longest cell per column, in characters, capped: the column's width is sized from it. */
      readonly columnChars: ReadonlyArray<number>;
    }
  | { readonly kind: "rule" };
