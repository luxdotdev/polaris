import { Option, Schema } from "effect";
import { LanguagePosition, LanguageRange, PredictionContextPiece } from "@polaris/protocol";
import type { LanguageJson, LanguageRequestFence } from "@polaris/protocol";
import { fileURLToPath } from "node:url";
import { positionOffset } from "../languages/runtime/documents.ts";
import { readSource, sourceName } from "./files.ts";

export interface LanguageSource {
  fence: LanguageRequestFence;
  methods: readonly string[];
  diagnostics: readonly { range: typeof LanguageRange.Type; message: string }[];
  request: (
    method: string,
    params: { textDocument: { uri: string }; position?: typeof LanguagePosition.Type },
    signal: AbortSignal
  ) => Promise<typeof LanguageJson.Type>;
  current: () => Promise<boolean>;
}

const Markup = Schema.Union([Schema.String, Schema.Struct({ value: Schema.String })]);

const Hover = Schema.NullOr(
  Schema.Struct({ contents: Schema.Union([Markup, Schema.Array(Markup)]) })
);

const Location = Schema.Struct({ uri: Schema.String, range: LanguageRange });

const Link = Schema.Struct({ targetUri: Schema.String, targetSelectionRange: LanguageRange });

const Definition = Schema.NullOr(
  Schema.Union([Location, Schema.Array(Location), Schema.Array(Link)])
);

const Symbols = Schema.Array(Schema.Struct({ name: Schema.String, range: LanguageRange }));

export function cursorPosition(buffer: string, cursor: number) {
  const before = buffer.slice(0, cursor);

  return { line: before.split("\n").length - 1, character: cursor - before.lastIndexOf("\n") - 1 };
}

function nearbyPositions(buffer: string, cursor: number) {
  const start = Math.max(0, cursor - 240);
  const near = buffer.slice(start, cursor);
  const matches = [...near.matchAll(/\b[A-Za-z_$][\w$]{2,}\b/g)].reverse();
  const seen = new Set<string>();
  const positions: ReturnType<typeof cursorPosition>[] = [];

  for (const match of matches) {
    if (
      seen.has(match[0]) ||
      /^(const|return|yield|await|function|export|import|from|true|false|undefined)$/.test(match[0])
    )
      continue;
    seen.add(match[0]);
    positions.push(cursorPosition(buffer, start + match.index));

    if (positions.length === 3) break;
  }

  return positions;
}

function decode<A, I>(schema: Schema.ConstraintDecoder<A>, value: I): A | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value));
}

const markup = (value: typeof Markup.Type) =>
  Schema.is(Schema.String)(value) ? value : value.value;

async function optionalRequest(
  source: LanguageSource,
  method: string,
  uri: string,
  signal: AbortSignal,
  position?: typeof LanguagePosition.Type
) {
  if (!source.methods.includes(method)) return null;

  try {
    return await source.request(
      method,
      position === undefined ? { textDocument: { uri } } : { textDocument: { uri }, position },
      signal
    );
  } catch {
    signal.throwIfAborted();

    return null;
  }
}

async function hover(
  source: LanguageSource,
  uri: string,
  position: typeof LanguagePosition.Type,
  signal: AbortSignal
) {
  const raw = decode(
    Hover,
    await optionalRequest(source, "textDocument/hover", uri, signal, position)
  );

  if (raw === undefined || raw === null) return "";
  const contents = decode(Markup, raw.contents);

  return (
    contents === undefined
      ? (decode(Schema.Array(Markup), raw.contents)?.map(markup).join("\n") ?? "")
      : markup(contents)
  ).slice(0, 1500);
}

async function definition(
  source: LanguageSource,
  root: string,
  uri: string,
  position: typeof LanguagePosition.Type,
  signal: AbortSignal
) {
  const raw = decode(
    Definition,
    await optionalRequest(source, "textDocument/definition", uri, signal, position)
  );

  if (raw === undefined || raw === null) return [];
  const single = decode(Location, raw);

  const locations: readonly (typeof Location.Type | typeof Link.Type)[] =
    single === undefined
      ? (decode(Schema.Array(Schema.Union([Location, Link])), raw) ?? [])
      : [single];

  const pieces: PredictionContextPiece[] = [];

  for (const location of locations.slice(0, 2)) {
    const target = Schema.is(Link)(location)
      ? { uri: location.targetUri, range: location.targetSelectionRange }
      : { uri: location.uri, range: location.range };

    try {
      const file = await readSource(root, fileURLToPath(target.uri), signal);

      if (file === undefined || target.uri === uri) continue;
      const line = target.range.start.line;

      const text = file.text
        .split("\n")
        .slice(line, line + 6)
        .join("\n")
        .slice(0, 1200);

      pieces.push(
        PredictionContextPiece.make({
          kind: "definition",
          source: sourceName(root, file.path),
          text,
        })
      );
    } catch {
      signal.throwIfAborted();
    }
  }

  return pieces;
}

export async function languagePieces(
  source: LanguageSource,
  root: string,
  path: string,
  buffer: string,
  cursor: number,
  signal: AbortSignal
) {
  const uri = source.fence.documents[0]!.uri;
  const positions = nearbyPositions(buffer, cursor);

  const groups = await Promise.all(
    positions.map(async (position) => {
      const [text, definitions] = await Promise.all([
        hover(source, uri, position, signal),
        definition(source, root, uri, position, signal),
      ]);

      return [
        ...(text === ""
          ? []
          : [
              PredictionContextPiece.make({
                kind: "definition",
                source: sourceName(root, path),
                text,
              }),
            ]),
        ...definitions,
      ];
    })
  );

  const raw = decode(
    Symbols,
    await optionalRequest(source, "textDocument/documentSymbol", uri, signal)
  );

  const near = buffer.slice(Math.max(0, cursor - 400), cursor);

  if (raw !== undefined) {
    for (const symbol of raw.slice(0, 128)) {
      if (!near.includes(symbol.name)) continue;
      const start = positionOffset(buffer, symbol.range.start, "utf-16");
      const end = positionOffset(buffer, symbol.range.end, "utf-16");
      groups.push([
        PredictionContextPiece.make({
          kind: "definition",
          source: sourceName(root, path),
          text: buffer
            .slice(start, Math.min(end, start + 800))
            .split("\n")
            .slice(0, 6)
            .join("\n"),
        }),
      ]);
    }
  }

  const line = cursorPosition(buffer, cursor).line;

  const diagnostics = source.diagnostics
    .filter((item) => Math.abs(item.range.start.line - line) <= 5)
    .slice(0, 4)
    .map((item) =>
      PredictionContextPiece.make({
        kind: "diagnostic",
        source: sourceName(root, path),
        text: `${item.range.start.line + 1}: ${item.message.slice(0, 600)}`,
      })
    );

  if (!(await source.current())) return [];
  const unique = new Map(groups.flat().map((piece) => [`${piece.source}\0${piece.text}`, piece]));

  return [...unique.values(), ...diagnostics];
}
