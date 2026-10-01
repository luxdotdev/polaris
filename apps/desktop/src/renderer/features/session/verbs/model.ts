/**
 * The Working strip's rotating verbs (DESIGN.md, Working strip): Polaris's
 * built-in list, the user's own from Settings → Sessions, and for Claude Code
 * the `spinnerVerbs` of its settings files, as Claude Code applies them.
 * Pure, so it is unit-tested.
 */
import type { SpinnerVerbs } from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";

/** Polaris's own, for every Harness until the user edits them. */
export const BUILT_IN_VERBS: ReadonlyArray<string> = [
  "Working…",
  "Reading the code…",
  "Thinking it through…",
  "Tracing the call…",
  "Following the types…",
  "Checking the diff…",
  "Weighing the options…",
  "Sketching a plan…",
  "Connecting the dots…",
  "Chasing a hunch…",
  "Untangling it…",
  "Lining things up…",
  "Tidying up…",
  "Flat out…",
  "Getting there…",
];

/** How long each verb stays, as in ChatDCA. */
export const VERB_ROTATE_MS = 6_000;

export const MAX_VERBS = 50;

export const MAX_VERB_LENGTH = 80;

const CONTROL = /\p{Cc}/gu;

/** One verb as typed: one line, trimmed, capped. Empty when nothing is left. */
export const cleanVerb = (value: string): string =>
  Array.from(value.replace(CONTROL, " ").replace(/\s+/g, " ").trim())
    .slice(0, MAX_VERB_LENGTH)
    .join("")
    .trim();

/** As the strip shows it: Claude Code's "Pondering" reads "Pondering…". */
export const shownVerb = (verb: string): string =>
  /(?:…|\.\.\.|[.!?])$/.test(verb) ? verb : `${verb}…`;

const keyOf = (verb: string) => shownVerb(verb).toLowerCase();

/** Cleaned, without blanks or duplicates (ignoring case and the ellipsis), capped. */
export const cleanVerbs = (verbs: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const kept: Array<string> = [];

  for (const raw of verbs) {
    const verb = cleanVerb(raw);
    const key = keyOf(verb);

    if (verb === "" || seen.has(key)) continue;
    seen.add(key);
    kept.push(verb);
  }

  return kept.slice(0, MAX_VERBS);
};

export interface ResolveInput {
  /** Settings → Sessions; null keeps the built-in ones. */
  readonly app: ReadonlyArray<string> | null;
  /** Claude Code's setting on the Host, for Claude Code sessions; null otherwise. */
  readonly claude: Plain<SpinnerVerbs> | null;
}

/** The verbs a Working strip rotates through, never empty. */
export const resolveVerbs = ({ app, claude }: ResolveInput): ReadonlyArray<string> => {
  const own = app === null ? BUILT_IN_VERBS : cleanVerbs(app);
  const base = own.length === 0 ? BUILT_IN_VERBS : own;

  if (claude === null) return base.map(shownVerb);

  const chosen = cleanVerbs(claude.mode === "replace" ? claude.verbs : [...base, ...claude.verbs]);

  return (chosen.length === 0 ? base : chosen).map(shownVerb);
};

/** The list as Settings edits it: the user's, or the built-in ones until they change it. */
export const editableVerbs = (app: ReadonlyArray<string> | null) => app ?? BUILT_IN_VERBS;

/** Adds a verb at the end; unchanged when it is blank, a duplicate, or the list is full. */
export const addVerb = (app: ReadonlyArray<string> | null, verb: string) =>
  cleanVerbs([...editableVerbs(app), verb]);

export const removeVerb = (app: ReadonlyArray<string> | null, index: number) =>
  editableVerbs(app).filter((_, at) => at !== index);

/** A random starting point, so two strips side by side don't say the same thing. */
export const startIndex = (count: number, random: () => number = Math.random) =>
  count === 0 ? 0 : Math.floor(random() * count) % count;
