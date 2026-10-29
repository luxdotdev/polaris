/**
 * Tool Calls that aren't Polaris's own, in words (DESIGN.md, Tool runs): an MCP server and its
 * tool as people say them, a Skill's name, the call's subject without ids, and its result.
 */
import type { McpTool, ToolKind, TurnItem } from "@polaris/protocol";
import { Option, Predicate, Schema } from "effect";

type ToolCallItem = Extract<TurnItem, { readonly _tag: "ToolCall" }>;

export type ToolInput = ToolCallItem["input"];

export type ToolOutput = ToolCallItem["output"];

/** An MCP tool as the conversation names it: "Linear", "save issue". */
export interface McpName {
  readonly server: string;
  readonly tool: string;
}

const words = (name: string) =>
  name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim();

/**
 * A server as people say it: connector prefixes gone (`claude_ai_Linear`, a plugin's
 * `plugin_<plugin>_<server>`), its casing kept, an all-lowercase name capitalized.
 */
export const serverName = (server: string): string => {
  const plugin = /^plugin_[^_]+_(.+)$/.exec(server)?.[1];
  const bare = (plugin ?? server).replace(/^claude_ai_/, "");
  const spaced = bare.replaceAll(/[_-]+/g, " ").trim();

  if (spaced === "") return server;

  return spaced === spaced.toLowerCase()
    ? spaced.charAt(0).toUpperCase() + spaced.slice(1)
    : spaced;
};

/** A tool's own name in words: `write_html` and `writeHtml` read "write html". */
export const toolWords = (tool: string): string => words(tool).toLowerCase() || tool;

const CLAUDE_MCP = /^mcp__(.+?)__(.+)$/;

/** The MCP tool a call names; older items, from before drivers said so, parse Claude's name. */
export const mcpName = (mcp: McpTool | null, name: string): McpName | null => {
  if (mcp !== null) return { server: serverName(mcp.server), tool: toolWords(mcp.tool) };
  const [, server, tool] = CLAUDE_MCP.exec(name) ?? [];

  return server === undefined || tool === undefined
    ? null
    : { server: serverName(server), tool: toolWords(tool) };
};

const SUBJECT_MAX = 80;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const ID_KEY = /(?:^id|Id|_id|Ids|_ids)$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A short, single-line argument worth reading: never an id, markup, or a body of text. */
const readable = (key: string, value: ToolInput): value is string =>
  Predicate.isString(value) &&
  value.trim() !== "" &&
  !ID_KEY.test(key) &&
  !UUID.test(value) &&
  !value.includes("\n") &&
  !value.trimStart().startsWith("<");

/** An MCP call's subject: its first one or two readable arguments ("Polaris · planned"). */
export const mcpSubject = (input: ToolInput): string => {
  if (!Predicate.isObject(input) || Array.isArray(input)) return "";

  const picked = Object.entries(input)
    .flatMap(([key, value]) => (readable(key, value) ? [value] : []))
    .slice(0, 2);

  return clip(picked.join(" · "), SUBJECT_MAX);
};

const stringAt = (input: ToolInput, key: string) => {
  const value = Predicate.hasProperty(input, key) ? input[key] : undefined;

  return Predicate.isString(value) && value !== "" ? value : null;
};

/** The Skill a call loads: Claude Code's `skill`, OpenCode's `name`. */
export const skillName = (input: ToolInput): string | null =>
  Predicate.isString(input) ? input : (stringAt(input, "skill") ?? stringAt(input, "name"));

/** Claude Code's ToolSearch only loads other tools' schemas: plumbing, never a phrase in a run. */
export const isPlumbing = (name: string): boolean => name === "ToolSearch";

const selectedTools = (query: string): number | null => {
  const selected = /^select:(.+)$/.exec(query)?.[1];

  return selected === undefined ? null : selected.split(",").filter((s) => s.trim() !== "").length;
};

/** How many tools a ToolSearch call loaded by name; 0 for a search by keyword. */
export const toolSearchCount = (input: ToolInput): number =>
  selectedTools(stringAt(input, "query") ?? "") ?? 0;

/** ToolSearch's subject: how many tools it loaded by name, else what it searched for. */
export const toolSearchSubject = (input: ToolInput): string => {
  const query = stringAt(input, "query") ?? "";
  const n = selectedTools(query);

  if (n === null) return clip(query, SUBJECT_MAX);

  return `${n} ${n === 1 ? "tool" : "tools"}`;
};

/** What a call returned, in a line: its text, a link in it, any images. */
export interface ToolResult {
  readonly text: string | null;
  readonly link: string | null;
  /** `data:` URLs of the images it returned, at most four. */
  readonly images: ReadonlyArray<string>;
}

const RESULT_MAX = 200;

const MAX_IMAGES = 4;

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/;

const TextBlock = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });

/** MCP's image content. */
const McpImage = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String,
});

/** Claude's image block, as Claude Code hands an MCP image back. */
const ClaudeImage = Schema.Struct({
  type: Schema.Literal("image"),
  source: Schema.Struct({ data: Schema.String, media_type: Schema.String }),
});

const Block = Schema.Union([TextBlock, McpImage, ClaudeImage]);

type Block = typeof Block.Type;

/** A result's content blocks: a bare list (Claude Code) or MCP's `{ content }` (Codex). */
const Blocks = Schema.Union([
  Schema.Array(Schema.Unknown),
  Schema.Struct({ content: Schema.Array(Schema.Unknown) }),
]);

const decodeBlocks = Schema.decodeUnknownOption(Blocks);

const decodeBlock = Schema.decodeUnknownOption(Block);

/** The text and image blocks a result carries; null when it isn't a list of blocks. */
const blocksOf = (output: ToolOutput): ReadonlyArray<Block> | null =>
  Option.match(decodeBlocks(output), {
    onNone: () => null,
    onSome: (decoded) =>
      ("content" in decoded ? decoded.content : decoded).flatMap((block) =>
        Option.toArray(decodeBlock(block))
      ),
  });

const imageUrl = (block: Block): string | null => {
  if ("data" in block) return `data:${block.mimeType};base64,${block.data}`;

  return "source" in block ? `data:${block.source.media_type};base64,${block.source.data}` : null;
};

const textOf = (output: ToolOutput, list: ReadonlyArray<Block> | null): string => {
  if (Predicate.isString(output)) return output;

  if (list === null) return output === null ? "" : (JSON.stringify(output) ?? "");

  return list.flatMap((block) => ("text" in block ? [block.text] : [])).join("\n");
};

/** A JSON list's length, for a result that is a list ("12 items"). */
const listLength = (text: string): number | null => {
  if (!text.trimStart().startsWith("[")) return null;

  try {
    const parsed: unknown = JSON.parse(text);

    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
};

const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() ?? "";

const resultLine = (text: string): string | null => {
  const n = listLength(text);

  if (n !== null) return `${n} ${n === 1 ? "item" : "items"}`;
  const line = firstLine(text);

  return line === "" ? null : clip(line, RESULT_MAX);
};

/** A call's result as one line, a link and its images; null when it returned nothing. */
export const toolResult = (output: ToolOutput): ToolResult | null => {
  if (output === null || output === undefined) return null;
  const list = blocksOf(output);
  const images = (list ?? []).map(imageUrl).filter(Predicate.isString);
  const text = textOf(output, list);

  const result = {
    text: resultLine(text),
    link: URL_PATTERN.exec(text)?.[0] ?? null,
    images: images.slice(0, MAX_IMAGES),
  };

  return result.text === null && result.images.length === 0 ? null : result;
};

/** A call's kind, from its driver; older items, from before drivers said so, have none. */
export const kindOf = (kind: ToolKind | null, mcp: McpName | null): ToolKind | null =>
  kind ?? (mcp === null ? null : "mcp");
