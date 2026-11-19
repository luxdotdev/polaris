/**
 * Claude Code's file tools (Edit, MultiEdit, Write, NotebookEdit) as `FileChange` items with
 * patches (ENG-979), and the "Writing <path>" item while a file tool's input streams.
 */
import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  countsOnlyPatch,
  type FilePatch,
  filePatch,
  joinFilePatches,
  patchFromUnifiedDiff,
  TurnItem,
} from "@polaris/protocol";
import { Effect, Option, Schema } from "effect";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolPayload } from "./payloads.ts";

export const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** A file's text before a Write: null when there was no file, undefined when unknown. */
export type Previous = string | null | undefined;

/** Reads a file's current text for a Write's patch; must be cheap (bounded, synchronous). */
export type ReadPrevious = (path: string) => Previous;

/** Larger files aren't read: a Write over one shows its patch once Claude Code reports it. */
const PREVIOUS_LIMIT = 1024 * 1024;

/** `ReadPrevious` on this Host's files, relative paths from `cwd`: a text file up to 1 MB. */
export const readPreviousFile =
  (cwd: string): ReadPrevious =>
  (path) => {
    const file = resolve(cwd, path);

    try {
      const stat = statSync(file, { throwIfNoEntry: false });

      if (stat === undefined) return null;

      if (!stat.isFile() || stat.size > PREVIOUS_LIMIT) return undefined;
      const text = readFileSync(file, "utf8");

      return text.includes("\0") ? undefined : text;
    } catch {
      return undefined;
    }
  };

interface FileCall {
  readonly id: string;
  readonly name: string;
  readonly input: ToolPayload;
  readonly status: "running" | "completed" | "failed" | "declined";
  readonly structured: ToolPayload;
  readonly previous?: Previous;
}

/** A field that reads as null when missing or of another shape. */
const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(schema).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
    Schema.withDecodingDefaultKey(Effect.succeed(null))
  );

const Edit = Schema.Struct({
  old_string: Schema.String,
  new_string: Schema.String,
});

const FileInput = Schema.Struct({
  file_path: lenient(Schema.String),
  notebook_path: lenient(Schema.String),
  old_string: lenient(Schema.String),
  new_string: lenient(Schema.String),
  content: lenient(Schema.String),
  edits: lenient(Schema.Array(Edit)),
  edit_mode: lenient(Schema.String),
  new_source: lenient(Schema.String),
});

const Hunk = Schema.Struct({
  oldStart: Schema.Number,
  oldLines: Schema.Number,
  newStart: Schema.Number,
  newLines: Schema.Number,
  lines: Schema.Array(Schema.String),
});

/** The structured result of Edit and Write: Claude Code's own diff of what it wrote. */
const FileResult = Schema.Struct({
  type: lenient(Schema.String),
  content: lenient(Schema.String),
  structuredPatch: lenient(Schema.Array(Hunk)),
  gitDiff: lenient(Schema.Struct({ additions: Schema.Number, deletions: Schema.Number })),
});

const decodeInput = Schema.decodeUnknownOption(FileInput);

const decodeResult = Schema.decodeUnknownOption(FileResult);

type Input = typeof FileInput.Type;

type Result = typeof FileResult.Type;

const NO_INPUT: Input = {
  file_path: null,
  notebook_path: null,
  old_string: null,
  new_string: null,
  content: null,
  edits: null,
  edit_mode: null,
  new_source: null,
};

const hunksText = (hunks: ReadonlyArray<typeof Hunk.Type>): string =>
  hunks
    .map(
      (hunk) =>
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n` +
        hunk.lines.map((line) => `${line}\n`).join("")
    )
    .join("");

/** The patch Claude Code reported once the tool ran: its hunks, else its counts. */
const resultPatch = (result: Result): FilePatch | null => {
  if (result.structuredPatch !== null && result.structuredPatch.length > 0)
    return patchFromUnifiedDiff(hunksText(result.structuredPatch));

  if (result.type === "create" && result.content !== null) return filePatch("", result.content);

  return result.gitDiff === null
    ? null
    : countsOnlyPatch(result.gitDiff.additions, result.gitDiff.deletions);
};

/** The patch the tool input describes. An Edit's line numbers count from its `old_string`. */
const inputPatch = (name: string, input: Input, previous: Previous): FilePatch | null => {
  switch (name) {
    case "Edit":
      return input.old_string === null || input.new_string === null
        ? null
        : filePatch(input.old_string, input.new_string);
    case "MultiEdit":
      return input.edits === null
        ? null
        : joinFilePatches(input.edits.map((edit) => filePatch(edit.old_string, edit.new_string)));
    case "Write":
      return input.content === null || previous === undefined
        ? null
        : filePatch(previous ?? "", input.content);
    case "NotebookEdit":
      return input.edit_mode === "insert" && input.new_source !== null
        ? filePatch("", input.new_source)
        : null;
    default:
      return null;
  }
};

const changeKind = (
  call: FileCall,
  input: Input,
  result: Result | null
): "add" | "delete" | "modify" => {
  if (result?.type === "create") return "add";

  if (call.name === "Write" && result === null && call.previous === null) return "add";

  return call.name === "NotebookEdit" && input.edit_mode === "delete" ? "delete" : "modify";
};

/** A file tool call's item: Claude Code's own diff once it ran, else the input's. */
export const fileChangeItem = (call: FileCall): TurnItem => {
  const input = Option.getOrElse(decodeInput(call.input), () => NO_INPUT);
  const result = call.status === "running" ? null : Option.getOrNull(decodeResult(call.structured));

  const patch =
    (result === null ? null : resultPatch(result)) ?? inputPatch(call.name, input, call.previous);

  const change = {
    path: input.file_path ?? input.notebook_path ?? "",
    kind: changeKind(call, input, result),
  };

  return TurnItem.cases.FileChange.make({
    id: call.id,
    changes: [patch === null ? change : { ...change, patch }],
    status: call.status,
  });
};

type StreamEvent = SDKPartialAssistantMessage["event"];

/** The path key, as far as the streamed JSON has it, with its value complete. */
const PATH_FIELD = /"(?:file_path|notebook_path)"\s*:\s*"((?:[^"\\]|\\.)*)"/;

/** Past this much streamed input without a path, it stops looking. */
const PATH_SEARCH_LIMIT = 4096;

const decodePath = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String));

/**
 * File tool calls whose input is still streaming, by block (`messageId:index`): once the
 * path has streamed, one running `FileChange` with `writing` shows "Writing <path>".
 */
export class FileToolStreams {
  private readonly open = new Map<string, { readonly id: string; json: string }>();

  /** The writing item for this event, once its block's path has streamed in. */
  onEvent(block: string, event: StreamEvent): TurnItem | null {
    switch (event.type) {
      case "content_block_start":
        if (event.content_block.type === "tool_use" && FILE_TOOLS.has(event.content_block.name))
          this.open.set(block, { id: event.content_block.id, json: "" });

        return null;
      case "content_block_delta":
        return event.delta.type === "input_json_delta"
          ? this.onInput(block, event.delta.partial_json)
          : null;
      case "content_block_stop":
        this.open.delete(block);

        return null;
      default:
        return null;
    }
  }

  private onInput(block: string, partial: string): TurnItem | null {
    const open = this.open.get(block);

    if (open === undefined) return null;
    open.json += partial;
    const match = PATH_FIELD.exec(open.json);
    const path = match === null ? Option.none() : decodePath(`"${match[1]}"`);

    if (Option.isNone(path)) {
      if (open.json.length > PATH_SEARCH_LIMIT) this.open.delete(block);

      return null;
    }

    this.open.delete(block);

    return TurnItem.cases.FileChange.make({
      id: open.id,
      changes: [{ path: path.value, kind: "modify" }],
      status: "running",
      writing: true,
    });
  }
}
