/**
 * Polaris's reply to a tool call, whatever shape the Harness kept it in: Claude Code's text
 * or content blocks, Codex's MCP result or error. Every reply is `summary`, `Revision`, `Next`.
 */
import { Option, Predicate, Schema } from "effect";
import type { Refusal, ToolCallItem } from "./types.ts";

const Block = Schema.Struct({ text: Schema.optionalKey(Schema.String) });

const Blocks = Schema.Array(Schema.Union([Schema.String, Block]));

const Envelope = Schema.Struct({
  content: Schema.optionalKey(Blocks),
  message: Schema.optionalKey(Schema.String),
});

const blocksText = (blocks: typeof Blocks.Type) =>
  blocks
    .map((block) => (Predicate.isString(block) ? block : (block.text ?? "")))
    .filter((text) => text !== "")
    .join("\n");

const decodeBlocks = Schema.decodeUnknownOption(Blocks);

const decodeEnvelope = Schema.decodeUnknownOption(Envelope);

/** The reply's text; JSON only for a shape no Harness sends today. */
export const outputText = ({ output }: ToolCallItem): string => {
  if (output === null || output === undefined) return "";

  if (Predicate.isString(output)) return output;

  const blocks = decodeBlocks(output);

  if (Option.isSome(blocks)) return blocksText(blocks.value);

  const envelope = decodeEnvelope(output);

  if (Option.isSome(envelope) && envelope.value.content !== undefined)
    return blocksText(envelope.value.content);

  if (Option.isSome(envelope) && envelope.value.message !== undefined)
    return envelope.value.message;

  return JSON.stringify(output, null, 2) ?? "";
};

export interface ToolResult {
  /** The reply's first line ("Dispatch recorded."), or the finding's message when refused. */
  readonly summary: string;
  /** The lines between the summary and `Revision`/`Next`. */
  readonly body: ReadonlyArray<string>;
  readonly revision: number | null;
  readonly refusal: Refusal | null;
}

// Claude Code prefixes a failed tool's text with "error: ".
const FINDING = /^(?:[Ee]rror: )?(E-[A-Z0-9-]+): (.+)$/;

const REVISION = /^Revision: (\d+)$/;

const isFooter = (line: string) => REVISION.test(line) || line.startsWith("Next: ");

/** The first finding of a refusal ("E-RATE: … / Fix: …"); null when Polaris recorded it. */
const refusalOf = (lines: ReadonlyArray<string>): Refusal | null => {
  const match = FINDING.exec(lines[0] ?? "");

  if (match === null) return null;
  const fix = lines[1]?.startsWith("Fix: ") === true ? lines[1].slice(5) : null;

  return { code: match[1] ?? "", message: match[2] ?? "", fix };
};

export const parseResult = (text: string): ToolResult => {
  const lines = text.replace(/\n$/, "").split("\n");
  const refusal = refusalOf(lines);
  const revisionLine = lines.find((line) => REVISION.test(line));
  const revision = revisionLine === undefined ? null : Number(REVISION.exec(revisionLine)?.[1]);

  return {
    summary: refusal?.message ?? lines[0] ?? "",
    body: refusal === null ? lines.slice(1).filter((line) => !isFooter(line)) : [],
    revision,
    refusal,
  };
};
