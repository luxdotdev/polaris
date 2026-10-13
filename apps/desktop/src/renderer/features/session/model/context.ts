/**
 * The Session context card (Paper "11 · Session context"): what fills the
 * window, as a meter of 100 cells (1% each) and a legend. Claude Code gives a
 * breakdown by category; other Harnesses give the total only.
 */
import type { Compaction, ContextUsage } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import { type Details, detailsOf } from "./contextDetails.ts";
import { CONTEXT_NEARLY_FULL, formatTokens } from "./meta.ts";

/** How a segment is drawn: the Harness hue at a strength, the free track, or the outlined reserve. */
export type Tone = "strong" | "medium" | "light" | "free" | "reserve";

export interface Segment {
  readonly key: string;
  readonly label: string;
  /** What the row opens to (Paper 11c); empty rows don't open. */
  readonly details: Details;
  readonly tokens: number;
  readonly tone: Tone;
}

export interface ContextCard {
  readonly used: number;
  /** Null when the Harness hasn't said: no meter, no percentage. */
  readonly window: number | null;
  /** 0–100, null without a window. */
  readonly percent: number | null;
  readonly nearlyFull: boolean;
  /** The Harness gave a total and no breakdown (Codex): the card says so rather than guessing. */
  readonly totalsOnly: boolean;
  /** Legend order: the conversation first, free and the reserve last. */
  readonly legend: ReadonlyArray<Segment>;
  /** 100 cells in window order (the system prompt first), each naming its segment. */
  readonly cells: ReadonlyArray<{ readonly key: string; readonly tone: Tone }>;
}

export const CELLS = 100;

/** Claude Code's `/context` names, grouped as the card shows them; any other name keeps its own row. */
const CONVERSATION = { key: "conversation", label: "Conversation", tone: "strong" } as const;

const TOOLS = { key: "tools", label: "Built-in tools", tone: "medium" } as const;

const MCP = { key: "mcp", label: "MCP servers", tone: "medium" } as const;

const SYSTEM = { key: "system", label: "System prompt and agents", tone: "medium" } as const;

const GROUPS = new Map<string, { key: string; label: string; tone: Tone }>([
  ["Messages", CONVERSATION],
  ["System tools", TOOLS],
  ["MCP tools", MCP],
  ["MCP server instructions", MCP],
  ["Skills", { key: "skills", label: "Skills", tone: "medium" }],
  ["Memory files", { key: "memory", label: "Memory files", tone: "light" }],
  ["System prompt", SYSTEM],
  ["Custom agents", SYSTEM],
]);

const LEGEND_ORDER = ["conversation", "tools", "mcp", "skills", "memory", "system"];

interface Group {
  key: string;
  label: string;
  tone: Tone;
  tokens: number;
}

/** Used categories grouped, in window order; Messages takes what was used since the count. */
const usedGroups = (usage: Plain<ContextUsage>): Group[] => {
  const groups = new Map<string, Group>();

  for (const category of usage.categories) {
    if (category.kind !== "used") continue;

    const group = GROUPS.get(category.name) ?? {
      key: `other:${category.name}`,
      label: category.name,
      tone: "medium" as const,
    };

    const found = groups.get(group.key);

    if (found === undefined) groups.set(group.key, { ...group, tokens: category.tokens });
    else found.tokens += category.tokens;
  }

  const lag = Math.max(0, usage.usedTokens - (usage.categoriesTotal ?? usage.usedTokens));
  const conversation = groups.get("conversation");

  if (conversation !== undefined) conversation.tokens += lag;
  else if (lag > 0) groups.set("conversation", { ...CONVERSATION, tokens: lag });

  return [...groups.values()];
};

const sumKind = (usage: Plain<ContextUsage>, kind: "free" | "buffer") =>
  usage.categories.filter((c) => c.kind === kind).reduce((n, c) => n + c.tokens, 0);

/** Window order: system first, the conversation last, as Claude Code's own meter fills. */
const WINDOW_RANK = new Map([
  ["memory", 1],
  ["conversation", 2],
]);

const windowOrder = (groups: ReadonlyArray<Group>) =>
  [...groups].sort((a, b) => (WINDOW_RANK.get(a.key) ?? 0) - (WINDOW_RANK.get(b.key) ?? 0));

const legendOrder = (groups: ReadonlyArray<Group>) => {
  const rank = (key: string) => {
    const i = LEGEND_ORDER.indexOf(key);

    return i === -1 ? LEGEND_ORDER.length : i;
  };

  return [...groups].sort((a, b) => rank(a.key) - rank(b.key));
};

const segmentsOf = (usage: Plain<ContextUsage>, window: number) => {
  const segment = (g: Group): Segment => ({
    key: g.key,
    label: g.label,
    details: detailsOf(usage, g.key),
    tokens: g.tokens,
    tone: g.tone,
  });

  if (usage.categories.length === 0) {
    const used: Group = {
      key: "used",
      label: "In context",
      tone: "strong",
      tokens: usage.usedTokens,
    };

    const free: Group = {
      key: "free",
      label: "Free",
      tone: "free",
      tokens: Math.max(0, window - usage.usedTokens),
    };

    return { inWindow: [used, free], legend: [segment(used), segment(free)] };
  }

  const groups = usedGroups(usage);
  const reserve = sumKind(usage, "buffer");
  const usedTotal = groups.reduce((n, g) => n + g.tokens, 0);
  // The lag Messages took comes out of free space, so the rows still add up to the window.
  const free = Math.max(0, Math.min(sumKind(usage, "free"), window - usedTotal - reserve));
  const freeGroup: Group = { key: "free", label: "Free", tone: "free", tokens: free };

  const reserveGroup: Group = {
    key: "reserve",
    label: "Kept free for auto-compact",
    tone: "reserve",
    tokens: reserve,
  };

  const tail = reserve > 0 ? [freeGroup, reserveGroup] : [freeGroup];

  return {
    inWindow: [...windowOrder(groups), ...tail],
    legend: [...legendOrder(groups).map(segment), ...tail.map(segment)],
  };
};

/** Cells per segment from rounded running totals, so they always add up to 100. */
const cellsOf = (inWindow: ReadonlyArray<Group>, window: number) => {
  const cells: Array<{ key: string; tone: Tone }> = [];
  let running = 0;

  for (const group of inWindow) {
    running += group.tokens;
    const until = Math.min(CELLS, Math.round((running / window) * CELLS));

    while (cells.length < until) cells.push({ key: group.key, tone: group.tone });
  }

  const last = inWindow.at(-1);

  while (cells.length < CELLS) cells.push({ key: last?.key ?? "free", tone: last?.tone ?? "free" });

  return cells;
};

export const contextCard = (usage: Plain<ContextUsage>): ContextCard => {
  const window = usage.windowTokens !== null && usage.windowTokens > 0 ? usage.windowTokens : null;

  if (window === null)
    return {
      used: usage.usedTokens,
      window: null,
      percent: null,
      nearlyFull: false,
      totalsOnly: usage.categories.length === 0,
      legend: [],
      cells: [],
    };
  const share = Math.min(1, Math.max(0, usage.usedTokens / window));
  const { inWindow, legend } = segmentsOf(usage, window);

  return {
    used: usage.usedTokens,
    window,
    percent: Math.round(share * 100),
    nearlyFull: share >= CONTEXT_NEARLY_FULL,
    totalsOnly: usage.categories.length === 0,
    legend,
    cells: cellsOf(inWindow, window),
  };
};

/** "90.0k", "119k", "4.6k": a row's tokens, one decimal under 100k. */
export const rowTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;

  if (tokens < 100_000) return `${(tokens / 1000).toFixed(1)}k`;

  return formatTokens(tokens);
};

/** A row's share of the window: "45%", "<1%" for a sliver. */
export const rowShare = (tokens: number, window: number): string => {
  const percent = (tokens / window) * 100;

  return tokens > 0 && percent < 0.5 ? "<1%" : `${Math.round(percent)}%`;
};

/** "Compacted at turn 31 · 188k → 36k", without what the Harness didn't say. */
export const compactionLine = (
  compaction: Plain<Compaction>,
  turnNumber: number | null
): string => {
  const head = turnNumber === null ? "Compacted" : `Compacted at turn ${turnNumber}`;
  const { beforeTokens: before, afterTokens: after } = compaction;

  if (before === null) return head;

  return after === null
    ? `${head} · from ${formatTokens(before)}`
    : `${head} · ${formatTokens(before)} → ${formatTokens(after)}`;
};

export interface SessionSpendBucket {
  readonly tokens: {
    readonly input: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly output: number;
  };
  readonly reportedCost: { readonly usd: number } | null;
  /** Main's API-price estimate; unpriced tokens leave it out. */
  readonly estimate?:
    | { readonly estimatedUsd: number; readonly unpricedTokens: number }
    | undefined;
}

export interface SessionSpend {
  /** "This session · 3.8M tokens · ~$4.12". */
  readonly line: string;
  /** "91% read from cache", or "No cost reported". */
  readonly detail: string | null;
}

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The card's footer: the session's tokens, its cost (estimated with "~"), and the cache share. */
export const sessionSpend = (buckets: ReadonlyArray<SessionSpendBucket>): SessionSpend | null => {
  if (buckets.length === 0) return null;
  let tokens = 0;
  let prompt = 0;
  let cached = 0;
  let cost = 0;
  let estimated = false;
  let priced = false;

  for (const b of buckets) {
    const { input, cacheRead, cacheWrite, output } = b.tokens;

    tokens += input + cacheRead + cacheWrite + output;
    prompt += input + cacheRead + cacheWrite;
    cached += cacheRead;

    if (b.reportedCost !== null) {
      cost += b.reportedCost.usd;
      priced = true;
    } else if (b.estimate !== undefined && b.estimate.unpricedTokens === 0) {
      cost += b.estimate.estimatedUsd;
      estimated = priced = true;
    }
  }

  const money = priced ? ` · ${estimated ? "~" : ""}${usd(cost)}` : "";

  const cacheShare =
    prompt === 0 ? null : `${Math.round((cached / prompt) * 100)}% read from cache`;

  return {
    line: `This session · ${formatTokens(tokens)} tokens${money}`,
    detail: priced ? cacheShare : "No cost reported",
  };
};
