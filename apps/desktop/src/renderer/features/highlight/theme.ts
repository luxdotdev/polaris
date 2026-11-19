/**
 * The Editor's syntax colours (editor/cm/theme.ts, `SYNTAX`) as a Zed-compatible theme for
 * `@pierre/highlights`: every token type names a `--color-*` token, so one palette serves
 * Moonlit and Light through the tokens' `light-dark()` values, with no re-highlighting.
 */
import { type Theme, type ThemeSyntaxSettings, tokenNames } from "@pierre/highlights";
import { MARKUP_WEIGHT, SYNTAX } from "../editor/cm/theme.ts";

export type SyntaxRole = keyof typeof SYNTAX;

/** Light or dark as the app shows it: Moonlit is the dark appearance. */
export type HighlightTheme = "moonlit" | "light";

/** Highlights' token types by the Editor's role; any type not listed is plain text. */
const ROLES: Readonly<Partial<Record<SyntaxRole, ReadonlyArray<string>>>> = {
  keyword: [
    "keyword",
    "keyword.control",
    "keyword.declaration",
    "keyword.import",
    "keyword.operator",
    "keyword.jsdoc",
    "boolean",
    "constant.builtin",
    "variable.special",
    "tag",
    "tag.doctype",
    "tag.jsx",
  ],
  string: [
    "string",
    "string.escape",
    "string.regex",
    "string.special",
    "string.special.symbol",
    "number",
    "text.literal",
    "link_uri",
  ],
  type: [
    "type",
    "type.builtin",
    "type.class",
    "type.jsdoc",
    "namespace",
    "constructor",
    "enum",
    "tag.component.jsx",
    "selector.class",
    "selector.id",
    "link_text",
  ],
  function: ["function", "function.definition", "function.method"],
  comment: ["comment", "comment.doc", "preproc"],
  punctuation: [
    "punctuation",
    "punctuation.bracket",
    "punctuation.bracket.html",
    "punctuation.bracket.jsx",
    "punctuation.delimiter",
    "punctuation.delimiter.html",
    "punctuation.delimiter.jsx",
    "punctuation.special",
    "operator",
  ],
  mark: ["punctuation.markup", "punctuation.list_marker"],
};

/** Markdown's hierarchy by weight and style, as the Editor draws it. */
const MARKUP = new Map<string, ThemeSyntaxSettings>([
  ["title", { color: SYNTAX.strong, font_weight: MARKUP_WEIGHT.heading2 }],
  ["emphasis.strong", { color: SYNTAX.strong, font_weight: MARKUP_WEIGHT.strong }],
  ["emphasis", { color: SYNTAX.text, font_style: "italic" }],
]);

/** Not syntax: Highlights reads these from `style`, never from `syntax`. */
const ROOT_TYPES = new Set(["none", "background", "foreground"]);

const roleOf = new Map(
  Object.entries(ROLES).flatMap(([role, types]) => types.map((type) => [type, role] as const))
);

/** Every token type's colour or style, so no span falls back to an undefined variable. */
const syntax = (): Record<string, string | ThemeSyntaxSettings> =>
  Object.fromEntries(
    tokenNames
      .filter((type) => !ROOT_TYPES.has(type))
      .map((type) => {
        const role = roleOf.get(type) ?? "text";

        // SAFETY: roleOf's values are ROLES' keys, which are SyntaxRole.
        return [type, MARKUP.get(type) ?? SYNTAX[role as SyntaxRole]];
      })
  );

/** The palette prefix: a colour `syntax-keyword` becomes `var(--color-syntax-keyword)`. */
export const TOKEN_PREFIX = "--color-";

const make = (appearance: "dark" | "light", name: string): Theme => ({
  name,
  appearance,
  cssVariables: { prefix: TOKEN_PREFIX },
  style: {
    "editor.foreground": SYNTAX.text,
    "editor.background": "panel",
    syntax: syntax(),
  },
});

/** The two themes, by the app's appearance. */
export const HIGHLIGHT_THEMES: Readonly<Record<HighlightTheme, Theme>> = {
  moonlit: make("dark", "polaris-moonlit"),
  light: make("light", "polaris-light"),
};

/** The theme for light or dark, as `useThemeType` answers. */
export const themeFor = (type: "dark" | "light"): HighlightTheme =>
  type === "dark" ? "moonlit" : "light";
