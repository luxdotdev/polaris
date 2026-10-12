/**
 * What a context card row opens to (Paper "11c · Session context · Breakdown open"): the
 * conversation by kind, MCP servers, the largest skills, memory files. Only what the Harness
 * counted; a row with nothing to show has no details.
 */
import type { ContextUsage } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import { plural } from "./format.ts";

export interface Detail {
  readonly key: string;
  readonly label: string;
  /** "4 of 76 tools", "15 servers". */
  readonly note: string | null;
  readonly tokens: number;
  /** A name from the Host (a server, a skill, a file): set in mono. */
  readonly mono: boolean;
}

export interface Details {
  /** Beside the row's label: "78", "3 files". */
  readonly count: string | null;
  readonly rows: ReadonlyArray<Detail>;
  /** The last line: what the rows leave out, with its tokens when they count in the row. */
  readonly footnote: { readonly text: string; readonly tokens: number | null } | null;
}

const NONE: Details = { count: null, rows: [], footnote: null };

const row = (label: string, tokens: number, note: string | null = null, mono = false): Detail => ({
  key: label,
  label,
  note,
  tokens,
  mono,
});

const conversation = (usage: Plain<ContextUsage>): Details => {
  const m = usage.messages;

  if (m === null) return NONE;

  const rows = [
    row("Tool results", m.toolResults),
    row("Replies", m.replies),
    row("Tool calls", m.toolCalls),
    row("Attachments and reminders", m.attachments + m.other),
    row("Your messages", m.userMessages),
  ]
    .filter((r) => r.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  return { count: null, rows, footnote: null };
};

const categoryTokens = (usage: Plain<ContextUsage>, name: string) =>
  usage.categories
    .filter((c) => c.kind === "used" && c.name === name)
    .reduce((n, c) => n + c.tokens, 0);

const mcp = (usage: Plain<ContextUsage>): Details => {
  const servers = usage.mcpServers;

  if (servers.length === 0) return NONE;

  const loaded = servers.filter((s) => s.loadedTools > 0);
  const waiting = servers.filter((s) => s.loadedTools === 0);
  const instructions = categoryTokens(usage, "MCP server instructions");

  const rows = [
    ...loaded.map((s) => ({
      ...row(s.name, s.tokens, `${s.loadedTools} of ${plural(s.tools, "tool")}`, true),
      key: `server:${s.name}`,
    })),
    ...(instructions > 0
      ? [row("Server instructions", instructions, plural(servers.length, "server"))]
      : []),
  ];

  const tools = waiting.reduce((n, s) => n + s.tools, 0);
  const more = loaded.length === 0 ? "" : " more";

  const text =
    waiting.length === 1
      ? `1${more} server loads its ${plural(tools, "tool")} on demand`
      : `${waiting.length}${more} servers load their ${plural(tools, "tool")} on demand`;

  return { count: null, rows, footnote: waiting.length === 0 ? null : { text, tokens: null } };
};

const skills = (usage: Plain<ContextUsage>): Details => {
  const s = usage.skills;

  if (s === null) return NONE;

  const rows = s.top.map((e) => ({ ...row(e.name, e.tokens, null, true), key: `skill:${e.name}` }));
  const rest = s.total - rows.length;
  const restTokens = Math.max(0, s.tokens - rows.reduce((n, r) => n + r.tokens, 0));

  return {
    count: `${s.total}`,
    rows,
    footnote: rest > 0 ? { text: `${rest} more`, tokens: restTokens } : null,
  };
};

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

const memory = (usage: Plain<ContextUsage>): Details => {
  const files = usage.memoryFiles;

  if (files.length === 0) return NONE;

  return {
    count: plural(files.length, "file"),
    rows: [...files]
      .sort((a, b) => b.tokens - a.tokens)
      .map((f) => ({ ...row(baseName(f.path), f.tokens, f.source, true), key: `file:${f.path}` })),
    footnote: null,
  };
};

const BUILDERS = new Map<string, (usage: Plain<ContextUsage>) => Details>([
  ["conversation", conversation],
  ["mcp", mcp],
  ["skills", skills],
  ["memory", memory],
]);

/** The details of the card row `key`, or none. */
export const detailsOf = (usage: Plain<ContextUsage>, key: string): Details =>
  BUILDERS.get(key)?.(usage) ?? NONE;
