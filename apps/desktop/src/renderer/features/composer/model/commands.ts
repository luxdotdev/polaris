/**
 * The composer's rules for Skills and Slash Commands, without an editor: what
 * the `/` menu offers for a typed word, which typed-through words become a
 * chip, and the text a Turn sends for a draft with chips in it.
 */
import type { SlashCommand } from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";
import { type FrecencyTable, frecencyScore, topFrecent } from "./frecency.ts";

export type CommandOption = Plain<SlashCommand>;

export type Sigil = CommandOption["sigil"];

/** A chip in the draft: which command it stands for. */
export interface CommandToken {
  readonly sigil: Sigil;
  readonly name: string;
}

export interface Draft {
  /** The text with each chip written as its sigil and name, in place. */
  readonly text: string;
  readonly tokens: ReadonlyArray<CommandToken>;
}

export const EMPTY_DRAFT: Draft = { text: "", tokens: [] };

/** The word under the caret that opens the menu: a sigil, then anything but whitespace. */
const TYPING = /^([/$])(\S*)$/;

/** A finished word: sigil and name, with whitespace after it. */
const COMPLETE = /([/$])([\w][\w:.-]*)(?=\s)/g;

/** The most rows the menu draws; typing narrows the rest. */
export const MENU_LIMIT = 50;

export interface Menu {
  readonly sigil: Sigil;
  readonly query: string;
  readonly options: ReadonlyArray<CommandOption>;
  /** How many more matched than the menu shows. */
  readonly more: number;
  /** For a bare sigil: how many of the first options are the user's frecent picks. */
  readonly recent: number;
}

/** How many frecent picks lead the menu before anything is typed. */
export const RECENT_LIMIT = 5;

/** What frecency counts a pick under: its sigil and name. */
export const frecencyKey = (option: Pick<CommandOption, "sigil" | "name">) =>
  `${option.sigil}${option.name}`;

/**
 * Where a sigil may open: `/` commands only lead the message, as the Harness
 * reads them only there, and only one may; a Codex `$` Skill goes anywhere.
 */
export const sigilOpen = (sigil: Sigil, atHead: boolean, tokens: ReadonlyArray<CommandToken>) =>
  sigil === "$" || (atHead && !tokens.some((t) => t.sigil === "/"));

/**
 * 0 for a prefix of the name, 1 for a prefix of a part (`codex:re` → `codex:review`),
 * 2 inside it from two letters on; Skills before other commands at each.
 */
const rank = (option: CommandOption, query: string): number | null => {
  const name = option.name.toLowerCase();
  const group = option.kind === "skill" ? 0 : 3;

  if (name.startsWith(query)) return group;

  if (name.split(/[:._-]/).some((part) => part.startsWith(query))) return group + 1;

  return query.length > 1 && name.includes(query) ? group + 2 : null;
};

/** A bare sigil: the user's frecent picks first ("Recent"), then the rest in the Daemon's order. */
const bareMenu = (
  sigil: Sigil,
  options: ReadonlyArray<CommandOption>,
  frecency: FrecencyTable,
  now: number
): Menu | null => {
  const listed = options.filter((o) => o.sigil === sigil);

  if (listed.length === 0) return null;
  const byKey = new Map(listed.map((o) => [frecencyKey(o), o]));

  const recent = topFrecent(frecency, RECENT_LIMIT * 2, now)
    .flatMap((key) => byKey.get(key) ?? [])
    .slice(0, RECENT_LIMIT);

  const rest = listed.filter((o) => !recent.includes(o));
  const all = [...recent, ...rest];

  return {
    sigil,
    query: "",
    options: all.slice(0, MENU_LIMIT),
    more: Math.max(0, all.length - MENU_LIMIT),
    recent: recent.length,
  };
};

/**
 * The menu for the word under the caret, or null when it isn't a command word
 * or nothing matches. Match quality ranks first (Skills before commands at each
 * level); the user's frecency of picks breaks ties within a level.
 */
export const matchMenu = (
  word: string,
  atHead: boolean,
  options: ReadonlyArray<CommandOption>,
  tokens: ReadonlyArray<CommandToken>,
  frecency: FrecencyTable = {},
  now = Date.now()
): Menu | null => {
  const match = TYPING.exec(word);

  if (match === null) return null;
  // SAFETY: TYPING's first group only matches "/" or "$".
  const sigil = match[1] as Sigil;
  const query = (match[2] ?? "").toLowerCase();

  if (!sigilOpen(sigil, atHead, tokens)) return null;

  if (query === "") return bareMenu(sigil, options, frecency, now);

  const ranked: Array<{
    readonly option: CommandOption;
    readonly rank: number;
    readonly frecent: number;
  }> = [];

  for (const option of options) {
    if (option.sigil !== sigil) continue;
    const r = rank(option, query);

    if (r !== null)
      ranked.push({ option, rank: r, frecent: frecencyScore(frecency[frecencyKey(option)], now) });
  }

  if (ranked.length === 0) return null;
  // Stable: with equal rank and frecency the Daemon's order (by name) holds.
  ranked.sort((a, b) => a.rank - b.rank || b.frecent - a.frecent);

  return {
    sigil,
    query,
    options: ranked.slice(0, MENU_LIMIT).map((r) => r.option),
    more: Math.max(0, ranked.length - MENU_LIMIT),
    recent: 0,
  };
};

/** Whether picking it inserts a chip: a `polaris` command runs in the Client instead. */
export const insertsChip = (option: CommandOption) => option.run !== "polaris";

export interface CompleteToken {
  readonly option: CommandOption;
  /** Where the sigil starts in the scanned text, and how many characters the word takes. */
  readonly start: number;
  readonly length: number;
}

/**
 * The first typed-through word (`/compact ` with its trailing space) naming a
 * listed command, which becomes a chip. `startsAtBoundary` and `atHead` say
 * where the scanned text sits; only what the editor can see decides them.
 */
export const findComplete = (
  text: string,
  options: ReadonlyArray<CommandOption>,
  tokens: ReadonlyArray<CommandToken>,
  context: { readonly startsAtBoundary: boolean; readonly atHead: boolean }
): CompleteToken | null => {
  for (const match of text.matchAll(COMPLETE)) {
    const start = match.index;
    const before = text.slice(0, start);
    const boundary = start === 0 ? context.startsAtBoundary : /\s$/.test(before);
    // SAFETY: COMPLETE's first group only matches "/" or "$".
    const sigil = match[1] as Sigil;
    const name = match[2] ?? "";
    const atHead = context.atHead && before.trim() === "";

    if (!boundary || !sigilOpen(sigil, atHead, tokens)) continue;
    const option = options.find((o) => o.sigil === sigil && o.name === name && insertsChip(o));

    if (option !== undefined) return { option, start, length: 1 + name.length };
  }

  return null;
};

/** `$ARGUMENTS` is everything after the command; `$1`…`$9` its words, as Codex's TUI expands them. */
const expand = (template: string, args: string) => {
  const words = args.split(/\s+/).filter((w) => w !== "");

  return template
    .replaceAll("$ARGUMENTS", args)
    .replace(/\$([1-9])/g, (_, n: string) => words[Number(n) - 1] ?? "");
};

/**
 * The text a Turn sends for a draft: chips stay as `/name` or `$name`, which
 * is how the Harness reads them, except a command with a template (a Codex
 * custom prompt), which only its TUI would expand: the Turn sends it expanded.
 */
export const promptFor = (text: string, options: ReadonlyArray<CommandOption>): string => {
  const lead = /^\s*\/(\S+)(.*)$/s.exec(text);
  const option = options.find((o) => o.sigil === "/" && o.name === lead?.[1]);

  if (lead === null || option?.template === null || option?.template === undefined) return text;

  return expand(option.template, (lead[2] ?? "").trim());
};
