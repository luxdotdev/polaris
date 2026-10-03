/**
 * Tool runs, as Claude Code and ChatDCA show them: consecutive successful
 * reads, searches, fetches, edits and commands fold into one line ("Read 3
 * files, searched for 2 patterns, ran 4 commands") that expands to each call.
 * Anything running, failed or declined, and every other kind, keeps its row.
 */
import type { ItemView } from "./items.ts";
import type { SubagentCard } from "./subagents.ts";

export type RunKind = "read" | "search" | "fetch" | "web-search" | "edit" | "shell";

/** Claude Code's and Codex's names for the tools that join runs (compared lowercase). */
const TOOL_KINDS = new Map<string, RunKind>([
  ["read", "read"],
  ["notebookread", "read"],
  ["ls", "read"],
  ["grep", "search"],
  ["glob", "search"],
  ["search", "search"],
  ["webfetch", "fetch"],
  ["websearch", "web-search"],
  ["web_search", "web-search"],
]);

/** What a call does in a run, or null when it keeps its own row. */
export const runKind = (item: ItemView): RunKind | null => {
  if (item.live) return null;

  switch (item.kind) {
    case "tool":
      return item.status === "completed" ? (TOOL_KINDS.get(item.name.toLowerCase()) ?? null) : null;
    case "command":
      return item.status === "completed" && (item.exitCode ?? 0) === 0 ? "shell" : null;
    case "files":
      return item.status === "completed" ? "edit" : null;
    default:
      return null;
  }
};

const count = (n: number, singular: string, plural = `${singular}s`) =>
  `${n} ${n === 1 ? singular : plural}`;

/** Fixed phrase order whatever the call order; edits count distinct files. */
const PHRASES: ReadonlyArray<readonly [RunKind, (n: number) => string]> = [
  ["read", (n) => `read ${count(n, "file")}`],
  ["search", (n) => `searched for ${count(n, "pattern")}`],
  ["fetch", (n) => `fetched ${count(n, "page")}`],
  ["web-search", (n) => `searched the web ${count(n, "time")}`],
  ["edit", (n) => `edited ${count(n, "file")}`],
  ["shell", (n) => `ran ${count(n, "command")}`],
];

const editedFiles = (items: ReadonlyArray<ItemView>) =>
  new Set(items.flatMap((i) => (i.kind === "files" ? i.changes.map((c) => c.path) : []))).size;

/** "Read 2 files, searched for 1 pattern, ran 3 commands". */
export const runSummary = (items: ReadonlyArray<ItemView>): string => {
  const counts = new Map<RunKind, number>();

  for (const item of items) {
    const kind = runKind(item);

    if (kind !== null) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  if (counts.has("edit")) counts.set("edit", editedFiles(items));

  const text = PHRASES.flatMap(([kind, phrase]) => {
    const n = counts.get(kind) ?? 0;

    return n > 0 ? [phrase(n)] : [];
  }).join(", ");

  return text.charAt(0).toUpperCase() + text.slice(1);
};

export type Entry =
  | { readonly kind: "item"; readonly item: ItemView }
  | {
      readonly kind: "run";
      /** The first call's id: stable while later calls join. */
      readonly id: string;
      readonly items: ReadonlyArray<ItemView>;
      readonly summary: string;
    }
  /** A Subagent, where the Turn spawned it. */
  | { readonly kind: "subagent"; readonly card: SubagentCard };

/** Items in order, consecutive run calls folded; a lone call keeps its own row. */
export const groupItems = (items: ReadonlyArray<ItemView>): ReadonlyArray<Entry> => {
  const entries: Array<Entry> = [];
  let pending: Array<ItemView> = [];

  const flush = () => {
    if (pending.length === 1 && pending[0] !== undefined)
      entries.push({ kind: "item", item: pending[0] });
    else if (pending.length > 1 && pending[0] !== undefined)
      entries.push({
        kind: "run",
        id: pending[0].id,
        items: pending,
        summary: runSummary(pending),
      });
    pending = [];
  };

  for (const item of items) {
    if (runKind(item) !== null) {
      pending.push(item);
      continue;
    }

    flush();
    entries.push({ kind: "item", item });
  }

  flush();

  return entries;
};

const VERBS = new Map<string, readonly [running: string, done: string]>([
  ["read", ["Reading", "Read"]],
  ["notebookread", ["Reading", "Read"]],
  ["ls", ["Listing", "Listed"]],
  ["grep", ["Searching", "Searched"]],
  ["glob", ["Finding files", "Found files"]],
  ["webfetch", ["Fetching", "Fetched"]],
  ["websearch", ["Searching the web", "Searched the web"]],
  ["web_search", ["Searching the web", "Searched the web"]],
  ["subagenthandback", ["Handing back its report", "Handed back its report"]],
]);

/** A tool's row label as a verb ("Read", "Searching"); its own name when unknown. */
export const toolVerb = (name: string, running: boolean): string => {
  const verbs = VERBS.get(name.toLowerCase());

  return verbs === undefined ? name : verbs[running ? 0 : 1];
};
