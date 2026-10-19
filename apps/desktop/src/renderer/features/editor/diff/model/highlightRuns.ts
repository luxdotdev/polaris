/**
 * A highlighted file's lines as token runs for the syntax-aware diff. Pierre colours each
 * span with the Moonlit theme's scope group (`--color-syntax-keyword`, diffs/theme.ts), so
 * the colour names the TextMate scopes a span matched; uncoloured text is plain code.
 */
import type { TokenKind, TokenRun } from "@polaris/syntax-diff";

/** The theme's scope groups as coarse kinds: types and functions are names like any other. */
const KINDS = new Map<string, TokenKind>([
  ["keyword", "keyword"],
  ["string", "string"],
  ["type", "identifier"],
  ["function", "identifier"],
  ["comment", "comment"],
  ["punctuation", "punctuation"],
]);

const GROUP = /var\(--color-syntax-([a-z]+)\)/;

/** A HAST property's value, as hast types it. */
export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number>;

/** The bits of a HAST node this reads: an element's style and children, a text's value. */
export interface HastNode {
  readonly type: string;
  readonly value?: string;
  readonly properties?: { readonly style?: PropertyValue };
  readonly children?: ReadonlyArray<HastNode>;
}

/** The theme's scope group a span's style names ("keyword" for `--color-syntax-keyword`). */
export const syntaxGroupOf = (style: PropertyValue): string | undefined =>
  GROUP.exec(String(style ?? ""))?.[1];

const kindOf = (style: PropertyValue): TokenKind => {
  const group = syntaxGroupOf(style);

  return (group === undefined ? undefined : KINDS.get(group)) ?? "other";
};

const collect = (node: HastNode, kind: TokenKind, runs: Array<TokenRun>) => {
  if (node.type === "text") {
    if (node.value !== undefined && node.value !== "") runs.push({ text: node.value, kind });

    return;
  }

  const own = node.properties?.style === undefined ? kind : kindOf(node.properties.style);

  for (const child of node.children ?? []) collect(child, own, runs);
};

/** One line's runs per line element (Pierre's `code` rows), in order. */
export const runsOfLines = (lines: ReadonlyArray<HastNode>): Array<Array<TokenRun>> =>
  lines.map((line) => {
    const runs: Array<TokenRun> = [];

    for (const child of line.children ?? []) collect(child, "other", runs);

    return runs;
  });
