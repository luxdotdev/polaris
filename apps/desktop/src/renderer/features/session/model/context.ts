/**
 * The Session context card (DESIGN.md, Session context card, redesigned; Paper X-F 02): what
 * fills the window, as a waffle of token cells coloured by category and a legend. Claude Code
 * gives a breakdown by category; other Harnesses give the total only.
 */
import type { Compaction, ContextUsage } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";
import { type Details, detailsOf } from "./contextDetails.ts";
import { CONTEXT_NEARLY_FULL, formatTokens } from "./meta.ts";

export interface Segment {
  /** Its category (rule/context-categories): conversation, system, tools, mcp, skills, memory,
   * free, reserve; "used" for a total-only count, "other:…" for a category Polaris doesn't group. */
  readonly key: string;
  readonly label: string;
  /** The legend's short name ("MCP", "Auto-compact"). */
  readonly short: string;
  /** What the row opens to (Paper 11c); empty rows don't open. */
  readonly details: Details;
  readonly tokens: number;
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
  /** Tokens per waffle cell: 1k up to a 200k window, then a round step that keeps ~200 cells. */
  readonly cellTokens: number;
  /** The waffle in window order (the system prompt first), each cell naming its segment. */
  readonly cells: ReadonlyArray<string>;
}

const CELL_STEPS = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000];

/** The smallest round cell that keeps the waffle at 200 cells or fewer. */
export const cellTokensFor = (window: number) =>
  CELL_STEPS.find((step) => window / step <= 200) ?? Math.ceil(window / 200);

/** Claude Code's `/context` names, grouped as the card shows them; any other name keeps its own row. */
const CONVERSATION = { key: "conversation", label: "Conversation", short: "Conversation" };

const TOOLS = { key: "tools", label: "Built-in tools", short: "Tools" };

const MCP = { key: "mcp", label: "MCP servers", short: "MCP" };

const SYSTEM = { key: "system", label: "System prompt and agents", short: "System" };

const GROUPS = new Map<string, { key: string; label: string; short: string }>([
  ["Messages", CONVERSATION],
  ["System tools", TOOLS],
  ["MCP tools", MCP],
  ["MCP server instructions", MCP],
  ["Skills", { key: "skills", label: "Skills", short: "Skills" }],
  ["Memory files", { key: "memory", label: "Memory files", short: "Memory" }],
  ["System prompt", SYSTEM],
  ["Custom agents", SYSTEM],
]);

const LEGEND_ORDER = ["conversation", "tools", "mcp", "skills", "memory", "system"];

interface Group {
  key: string;
  label: string;
  short: string;
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
      short: category.name,
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
    short: g.short,
    details: detailsOf(usage, g.key),
    tokens: g.tokens,
  });

  if (usage.categories.length === 0) {
    const used: Group = {
      key: "used",
      label: "In context",
      short: "In context",
      tokens: usage.usedTokens,
    };

    const free: Group = {
      key: "free",
      label: "Free",
      short: "Free",
      tokens: Math.max(0, window - usage.usedTokens),
    };

    return { inWindow: [used, free], legend: [segment(used), segment(free)] };
  }

  const groups = usedGroups(usage);
  const reserve = sumKind(usage, "buffer");
  const usedTotal = groups.reduce((n, g) => n + g.tokens, 0);
  // The lag Messages took comes out of free space, so the rows still add up to the window.
  const free = Math.max(0, Math.min(sumKind(usage, "free"), window - usedTotal - reserve));
  const freeGroup: Group = { key: "free", label: "Free", short: "Free", tokens: free };

  const reserveGroup: Group = {
    key: "reserve",
    label: "Kept free for auto-compact",
    short: "Auto-compact",
    tokens: reserve,
  };

  const tail = reserve > 0 ? [freeGroup, reserveGroup] : [freeGroup];

  return {
    inWindow: [...windowOrder(groups), ...tail],
    legend: [...legendOrder(groups).map(segment), ...tail.map(segment)],
  };
};

/** Cells per segment from rounded running totals, so they always fill the window's cells. */
const cellsOf = (inWindow: ReadonlyArray<Group>, window: number, cellTokens: number) => {
  const count = Math.ceil(window / cellTokens);
  const cells: string[] = [];
  let running = 0;

  for (const group of inWindow) {
    running += group.tokens;
    const until = Math.min(count, Math.round(running / cellTokens));

    while (cells.length < until) cells.push(group.key);
  }

  const last = inWindow.at(-1)?.key ?? "free";

  while (cells.length < count) cells.push(last);

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
      cellTokens: 0,
      cells: [],
    };
  const share = Math.min(1, Math.max(0, usage.usedTokens / window));
  const { inWindow, legend } = segmentsOf(usage, window);
  const cellTokens = cellTokensFor(window);

  return {
    used: usage.usedTokens,
    window,
    percent: Math.round(share * 100),
    nearlyFull: share >= CONTEXT_NEARLY_FULL,
    totalsOnly: usage.categories.length === 0,
    legend,
    cellTokens,
    cells: cellsOf(inWindow, window, cellTokens),
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
  /** "~$4.12" (estimated) or "$4.12"; null when nothing was priced. */
  readonly cost: string | null;
  /** The share of prompt tokens read from cache, 0–100; null before any prompt. */
  readonly cacheShare: number | null;
  /** Prompt tokens read from cache, and written or sent fresh. */
  readonly cached: number;
  readonly fresh: number;
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

  const price = priced ? `${estimated ? "~" : ""}${usd(cost)}` : null;
  const money = price === null ? "" : ` · ${price}`;

  const share = prompt === 0 ? null : Math.round((cached / prompt) * 100);
  const cacheLine = share === null ? null : `${share}% read from cache`;

  return {
    line: `This session · ${formatTokens(tokens)} tokens${money}`,
    detail: priced ? cacheLine : "No cost reported",
    cost: price,
    cacheShare: share,
    cached,
    fresh: prompt - cached,
  };
};
