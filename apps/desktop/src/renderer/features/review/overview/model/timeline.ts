/**
 * The Conversation tab's timeline: the All · People · Bots filter, where "New since your
 * last review" falls, which bot comments fold, and the few lines a thread quotes.
 */
import type { PersonView, TimelineItemView } from "./types.ts";

export type TimelineFilter = "all" | "people" | "bots";

/** Who wrote the item; a push by no known author counts as a person's. */
export const authorOf = (item: TimelineItemView): PersonView | null =>
  item.kind === "thread" ? (item.comments[0]?.author ?? null) : item.author;

const isBot = (item: TimelineItemView) => authorOf(item)?.bot === true;

export const filterTimeline = (
  items: ReadonlyArray<TimelineItemView>,
  filter: TimelineFilter
): ReadonlyArray<TimelineItemView> => {
  if (filter === "all") return items;

  return items.filter((item) => (filter === "bots" ? isBot(item) : !isBot(item)));
};

/** "12 comments from 4 people and 1 bot". */
const authorsOf = (items: ReadonlyArray<TimelineItemView>) =>
  items.flatMap((item) =>
    item.kind === "thread" ? item.comments.map((c) => c.author) : [authorOf(item)]
  );

const n = (count: number, word: string, many = `${word}s`) =>
  `${count} ${count === 1 ? word : many}`;

export const peopleLine = (items: ReadonlyArray<TimelineItemView>, comments: number) => {
  const people = new Set<string>();
  const bots = new Set<string>();

  for (const author of authorsOf(items)) {
    if (author !== null) (author.bot ? bots : people).add(author.login);
  }

  const who: Array<string> = [];

  if (people.size > 0) who.push(n(people.size, "person", "people"));

  if (bots.size > 0) who.push(n(bots.size, "bot"));

  const said = n(comments, "comment");

  return who.length === 0 ? said : `${said} from ${who.join(" and ")}`;
};

/** The index of the first item after the viewer's last review; null when none is new. */
export const newSinceIndex = (
  items: ReadonlyArray<TimelineItemView>,
  lastReviewAt: string | null
): number | null => {
  if (lastReviewAt === null) return null;
  const at = Date.parse(lastReviewAt);
  const index = items.findIndex((item) => Date.parse(item.at) > at);

  return index === -1 ? null : index;
};

/** Items after the viewer's last review, for the re-review lead on Overview. */
export const newSince = (
  items: ReadonlyArray<TimelineItemView>,
  lastReviewAt: string | null
): ReadonlyArray<TimelineItemView> => {
  const index = newSinceIndex(items, lastReviewAt);

  return index === null ? [] : items.slice(index);
};

/** A bot comment longer than this folds to its first lines, with "Show all". */
export const FOLD_LINES = 6;

export const FOLD_CHARS = 600;

export const isLong = (body: string) =>
  body.split("\n").length > FOLD_LINES || body.length > FOLD_CHARS;

/** A long comment's opening: its first paragraph, or its first lines. */
export const foldedBody = (body: string) => {
  const paragraph = body.trim().split(/\n\s*\n/)[0] ?? "";
  const lines = paragraph.split("\n").slice(0, FOLD_LINES).join("\n");

  return lines.length > FOLD_CHARS ? `${lines.slice(0, FOLD_CHARS).trimEnd()}…` : lines;
};

export interface SnippetLine {
  readonly kind: "add" | "del" | "ctx";
  /** The line's number on its side; null for a removed line on the new side. */
  readonly number: number | null;
  readonly text: string;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const kindOf = (line: string): SnippetLine["kind"] => {
  if (line.startsWith("+")) return "add";

  return line.startsWith("-") ? "del" : "ctx";
};

/** The last `count` lines of GitHub's `diffHunk` (it ends on the commented line), numbered. */
export const snippetOf = (diffHunk: string, count = 2): ReadonlyArray<SnippetLine> => {
  const [header = "", ...body] = diffHunk.split("\n");
  const match = HUNK.exec(header);
  let oldLine = Number(match?.[1] ?? 1);
  let newLine = Number(match?.[2] ?? 1);

  const lines = (match === null ? diffHunk.split("\n") : body).map((raw): SnippetLine => {
    const kind = kindOf(raw);
    const number = kind === "del" ? oldLine : newLine;

    if (kind !== "add") oldLine += 1;

    if (kind !== "del") newLine += 1;

    return { kind, number, text: raw.slice(1) };
  });

  return lines.filter((l) => l.text.trim() !== "" || l.kind !== "ctx").slice(-count);
};

export type ThreadItem = Extract<TimelineItemView, { readonly kind: "thread" }>;

/** What the timeline draws: an item, a run of one author's open threads, or a folded resolved one. */
export type TimelineEntry =
  | { readonly kind: "item"; readonly item: TimelineItemView }
  | {
      readonly kind: "threads";
      readonly id: string;
      readonly author: PersonView | null;
      readonly at: string;
      readonly threads: ReadonlyArray<ThreadItem>;
    }
  | { readonly kind: "resolved"; readonly thread: ThreadItem };

const entryOf = (item: TimelineItemView): TimelineEntry => {
  if (item.kind !== "thread") return { kind: "item", item };

  if (item.isResolved) return { kind: "resolved", thread: item };

  return { kind: "threads", id: item.id, author: authorOf(item), at: item.at, threads: [item] };
};

type PushItem = Extract<TimelineItemView, { readonly kind: "push" }>;

/** Pushes in a row by one author read as one: "pushed 3 commits". */
const joinPush = (last: TimelineEntry | undefined, item: TimelineItemView): PushItem | null => {
  if (item.kind !== "push" || last?.kind !== "item" || last.item.kind !== "push") return null;

  if (last.item.author?.login !== item.author?.login || last.item.forced || item.forced)
    return null;

  return { ...item, id: last.item.id, commits: [...last.item.commits, ...item.commits] };
};

/** Consecutive open threads by one author share a card ("commented on 2 lines"). */
export const timelineEntries = (
  items: ReadonlyArray<TimelineItemView>
): ReadonlyArray<TimelineEntry> =>
  items.reduce<Array<TimelineEntry>>((entries, item) => {
    const entry = entryOf(item);
    const last = entries.at(-1);
    const push = joinPush(last, item);

    if (push !== null) {
      entries[entries.length - 1] = { kind: "item", item: push };

      return entries;
    }

    if (
      entry.kind === "threads" &&
      last?.kind === "threads" &&
      last.author?.login === entry.author?.login
    ) {
      entries[entries.length - 1] = { ...last, threads: [...last.threads, ...entry.threads] };
    } else entries.push(entry);

    return entries;
  }, []);
