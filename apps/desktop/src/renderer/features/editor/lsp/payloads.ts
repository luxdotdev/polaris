import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";

const bounded = <S extends Schema.Constraint>(item: S) =>
  Schema.Array(item).check(Schema.isMaxLength(2000));

const label = Schema.String.check(Schema.isMaxLength(65536));

export const Markup = Schema.Union([
  label,
  Schema.Struct({ kind: Schema.Literals(["plaintext", "markdown"]), value: label }),
  Schema.Struct({ language: label, value: label }),
]);

export const Hover = Schema.NullOr(
  Schema.Struct({
    contents: Schema.Union([Markup, bounded(Markup)]),
    range: Schema.optionalKey(P.LanguageRange),
  })
);

export const CompletionItem = Schema.Struct({
  label,
  detail: Schema.optionalKey(label),
  kind: Schema.optionalKey(Schema.Int),
  sortText: Schema.optionalKey(label),
  filterText: Schema.optionalKey(label),
  insertText: Schema.optionalKey(label),
  textEditText: Schema.optionalKey(label),
  insertTextFormat: Schema.optionalKey(Schema.Literals([1, 2])),
  documentation: Schema.optionalKey(Markup),
  labelDetails: Schema.optionalKey(
    Schema.Struct({ detail: Schema.optionalKey(label), description: Schema.optionalKey(label) })
  ),
  textEdit: Schema.optionalKey(
    Schema.Union([
      P.LanguageTextEdit,
      Schema.Struct({ newText: label, insert: P.LanguageRange, replace: P.LanguageRange }),
    ])
  ),
  additionalTextEdits: Schema.optionalKey(bounded(P.LanguageTextEdit)),
  command: Schema.optionalKey(P.LanguageJsonObject),
  data: Schema.optionalKey(P.LanguageJson),
});

export type CompletionItem = typeof CompletionItem.Type;

export const CompletionResult = Schema.NullOr(
  Schema.Union([
    bounded(CompletionItem),
    Schema.Struct({
      isIncomplete: Schema.Boolean,
      items: bounded(CompletionItem),
      itemDefaults: Schema.optionalKey(
        Schema.Struct({
          editRange: Schema.optionalKey(
            Schema.Union([
              P.LanguageRange,
              Schema.Struct({ insert: P.LanguageRange, replace: P.LanguageRange }),
            ])
          ),
          insertTextFormat: Schema.optionalKey(Schema.Literals([1, 2])),
          data: Schema.optionalKey(P.LanguageJson),
        })
      ),
    }),
  ])
);

export const completionItems = (
  payload: NonNullable<typeof CompletionResult.Type>
): readonly CompletionItem[] => {
  if (!("items" in payload)) return payload;
  const defaults = payload.itemDefaults;

  if (!defaults) return payload.items;

  return payload.items.map((item) => {
    let normalized = item;

    if (item.insertTextFormat === undefined && defaults.insertTextFormat !== undefined)
      normalized = { ...normalized, insertTextFormat: defaults.insertTextFormat };

    if (item.data === undefined && defaults.data !== undefined)
      normalized = { ...normalized, data: defaults.data };

    if (item.textEdit === undefined && defaults.editRange !== undefined) {
      const newText = item.textEditText ?? item.insertText ?? item.label;
      const range = defaults.editRange;
      const textEdit = "start" in range ? { range, newText } : { ...range, newText };
      normalized = { ...normalized, textEdit };
    }

    return CompletionItem.make(normalized);
  });
};

export const Signature = Schema.NullOr(
  Schema.Struct({
    signatures: bounded(
      Schema.Struct({
        label,
        documentation: Schema.optionalKey(Markup),
        parameters: Schema.optionalKey(
          bounded(
            Schema.Struct({
              label: Schema.Union([label, Schema.Tuple([P.LanguageCounter, P.LanguageCounter])]),
              documentation: Schema.optionalKey(Markup),
            })
          )
        ),
        activeParameter: Schema.optionalKey(P.LanguageCounter),
      })
    ),
    activeSignature: Schema.optionalKey(P.LanguageCounter),
    activeParameter: Schema.optionalKey(P.LanguageCounter),
  })
);

export const Location = Schema.Struct({ uri: P.LanguageUri, range: P.LanguageRange });

export const LocationLink = Schema.Struct({
  targetUri: P.LanguageUri,
  targetRange: P.LanguageRange,
  targetSelectionRange: P.LanguageRange,
  originSelectionRange: Schema.optionalKey(P.LanguageRange),
});

export const Locations = Schema.NullOr(
  Schema.Union([Location, bounded(Schema.Union([Location, LocationLink]))])
);

export const SymbolInformation = Schema.Struct({
  name: label,
  kind: Schema.Int,
  location: Location,
  containerName: Schema.optionalKey(label),
});

interface DocumentSymbolValue {
  readonly name: string;
  readonly kind: number;
  readonly range: typeof P.LanguageRange.Type;
  readonly selectionRange: typeof P.LanguageRange.Type;
  readonly children?: readonly DocumentSymbolValue[];
}

export const DocumentSymbol: Schema.Codec<DocumentSymbolValue> = Schema.Struct({
  name: label,
  kind: Schema.Int,
  range: P.LanguageRange,
  selectionRange: P.LanguageRange,
  children: Schema.optionalKey(Schema.suspend(() => bounded(DocumentSymbol))),
});

export const DocumentSymbols = Schema.NullOr(
  Schema.Union([bounded(SymbolInformation), bounded(DocumentSymbol)])
);

export const WorkspaceSymbols = Schema.NullOr(
  bounded(
    Schema.Struct({
      name: label,
      kind: Schema.Int,
      location: Schema.Struct({ uri: P.LanguageUri, range: Schema.optionalKey(P.LanguageRange) }),
      containerName: Schema.optionalKey(label),
      data: Schema.optionalKey(P.LanguageJson),
    })
  )
);

export const CodeActions = Schema.NullOr(
  bounded(
    Schema.Struct({
      title: label,
      kind: Schema.optionalKey(label),
      disabled: Schema.optionalKey(Schema.Struct({ reason: label })),
      edit: Schema.optionalKey(P.LanguageWorkspaceEdit),
      command: Schema.optionalKey(Schema.Union([label, P.LanguageJsonObject])),
      arguments: Schema.optionalKey(Schema.Array(P.LanguageJson)),
      data: Schema.optionalKey(P.LanguageJson),
    })
  )
);

export const PullDiagnostic = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("full"),
    resultId: Schema.optionalKey(Schema.String),
    items: bounded(
      Schema.Struct({
        range: P.LanguageRange,
        message: label,
        severity: Schema.optionalKey(Schema.Literals([1, 2, 3, 4])),
        code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Int])),
        source: Schema.optionalKey(label),
        tags: Schema.optionalKey(Schema.Array(Schema.Literals([1, 2]))),
        data: Schema.optionalKey(P.LanguageJson),
      })
    ),
  }),
  Schema.Struct({ kind: Schema.Literal("unchanged"), resultId: Schema.String }),
]);

/** Rendering owns Markdown sanitization; adapters return text and never inject server HTML. */
export const markupText = (markup: typeof Markup.Type): string =>
  Predicate.isString(markup) ? markup : markup.value;

export interface HoverPart {
  readonly kind: "markdown" | "plaintext";
  readonly text: string;
}

export const fence = (language: string, value: string) => {
  const ticks = "`".repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map((m) => m[0].length + 1)));

  return `${ticks}${language.replace(/[`\s]/g, "")}\n${value}\n${ticks}`;
};

/** LSP marked strings are Markdown; a `{language, value}` pair is a fenced code block. */
export const hoverPart = (markup: typeof Markup.Type): HoverPart => {
  if (Predicate.isString(markup)) return { kind: "markdown", text: markup };

  if ("language" in markup) return { kind: "markdown", text: fence(markup.language, markup.value) };

  return { kind: markup.kind, text: markup.value };
};

const EMPTY_FENCE = /^ {0,3}(`{3,}|~{3,})[^\n`]*\n(?:[ \t]*\n)*[ \t]*\1[ \t]*$/gm;

/** Markdown backslash escapes and the entities servers write for `<`, `>`, `&` and spaces. */
const unescape = (line: string) =>
  line
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, "$1")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/ {2}$/, "");

/** A pydoc call line: `str(object='') -> str`, `str(bytes_or_buffer[, encoding]) -> str`. */
const PYDOC = /^[A-Za-z_][\w.]*\(.*\)(?: -> .+)?$/;

/** Docs opening with pydoc call lines (after a `---` rule) get them as code, not prose. */
const fencePydoc = (text: string) =>
  text.replace(/\n---\n([^\n]+(?:\n[^\n]+)*)/, (whole, paragraph: string) => {
    const lines = paragraph.split("\n").map(unescape);

    return lines.every((line) => PYDOC.test(line))
      ? `\n---\n${fence("", lines.join("\n"))}`
      : whole;
  });

/** Images (CSS's Baseline badge is a data URI) never render; any text beside them stays. */
const IMAGE = /!\[[^\]]*\]\([^)]*\)[ \t]*/g;

/** CSS and HTML servers' `Syntax: <grammar>` line, escaped as prose, becomes a label and code. */
const fenceSyntax = (text: string) =>
  text.replace(
    /^Syntax: (.+)$/m,
    (_whole, grammar: string) => `Syntax\n\n${fence("", unescape(grammar))}`
  );

/** Docs Markdown without the noise servers send: images, empty fences, blank runs, pydoc as prose. */
export const tidyDocs = (part: HoverPart): HoverPart => {
  const collapsed = part.text.replace(/\n[ \t]*(?:\n[ \t]*){2,}/g, "\n\n").trim();

  if (part.kind === "plaintext") return { kind: "plaintext", text: collapsed };
  const cleaned = collapsed.replace(EMPTY_FENCE, "").replace(IMAGE, "");

  return { kind: "markdown", text: fenceSyntax(fencePydoc(cleaned)).trim() };
};

type HoverContents = NonNullable<typeof Hover.Type>["contents"];

export const hoverParts = (contents: HoverContents): readonly HoverPart[] =>
  (Predicate.isString(contents) || "value" in contents ? [contents] : contents)
    .map((markup) => tidyDocs(hoverPart(markup)))
    .filter((part) => part.text !== "");

export const decodePayload = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: typeof P.LanguageJson.Type
): S["Type"] | undefined => {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch {
    return undefined;
  }
};
