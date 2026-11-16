/**
 * An Agent Session's Comments as the transcript and the diffs show them (ADR 0113, DESIGN.md
 * "Shared Sessions"): who wrote each, its marks, where it sits, and who sent each Turn.
 */
import { Actor } from "@polaris/protocol";
import { Predicate } from "effect";
import type { SessionComment } from "../../../store/sessionComments.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { groupOf, groupTurns } from "../../session/model/turnGroups.ts";

export type { SessionComment };

const isTeammate = (actor: Actor | null | undefined) =>
  actor != null && Predicate.isTagged(actor, "Teammate");

/**
 * Whether the session is or was shared: a Teammate sent a Turn, wrote or resolved a Comment.
 * Nothing about sharing shows otherwise (DESIGN.md, rule/solo-is-unchanged).
 */
export const wasShared = (
  turns: ReadonlyArray<TurnView>,
  comments: ReadonlyArray<SessionComment>
): boolean =>
  turns.some((v) => isTeammate(v.turn.actor)) ||
  comments.some((c) => isTeammate(c.author) || isTeammate(c.resolvedBy));

/** "You" for the owner's own Clients, else the Teammate's, Extension's or device's name. */
export const actorName = (actor: Actor): string =>
  Actor.match(actor, {
    Client: () => "You",
    Extension: (a) => a.name,
    LinkedDevice: (a) => a.name,
    Teammate: (a) => a.name,
  });

/** The prompt's author slot: a Teammate or the owner by name, an Extension or device as "from …". */
export const turnAuthorLabel = (actor: Actor): string =>
  Actor.match(actor, {
    Client: () => "You",
    Extension: (a) => `from ${a.name}`,
    LinkedDevice: (a) => `from ${a.name}`,
    Teammate: (a) => a.name,
  });

/** The UI's Turn number for a Turn id ("turn 25"), or null for one not loaded. */
export const turnNumberOf = (views: ReadonlyArray<TurnView>) => {
  const groups = groupTurns(views);

  return (turnId: string | null | undefined): number | null =>
    turnId == null ? null : (groupOf(groups, turnId)?.number ?? null);
};

/** Its marks after the author: "Sent with turn 25", "Outdated", "Resolved". */
export const commentMarks = (
  comment: SessionComment,
  turnNumber: (turnId: string | null | undefined) => number | null
): ReadonlyArray<string> => {
  const sent = turnNumber(comment.sentInTurnId);
  const marks: Array<string> = [];

  if (comment.sentInTurnId != null) marks.push(sent === null ? "Sent" : `Sent with turn ${sent}`);

  if (comment.outdatedInTurnId != null) marks.push("Outdated");

  if (comment.resolvedAt != null) marks.push("Resolved");

  return marks;
};

/** Comments not yet sent nor resolved: what "Send as a turn" offers. */
export const unsentComments = (comments: ReadonlyArray<SessionComment>) =>
  comments.filter((c) => c.sentInTurnId == null && c.resolvedAt == null);

type MessageComment = SessionComment & {
  readonly anchor: Extract<SessionComment["anchor"], { _tag: "MessageText" }>;
};

type LineComment = SessionComment & {
  readonly anchor: Extract<SessionComment["anchor"], { _tag: "DiffLines" }>;
};

const onMessage = (c: SessionComment): c is MessageComment =>
  Predicate.isTagged(c.anchor, "MessageText");

const onLines = (c: SessionComment): c is LineComment => Predicate.isTagged(c.anchor, "DiffLines");

/** A message's Comments, oldest first. */
export const messageComments = (
  comments: ReadonlyArray<SessionComment>,
  messageId: string
): ReadonlyArray<MessageComment> =>
  comments.filter(onMessage).filter((c) => c.anchor.messageId === messageId);

/** Line Comments as threads: one per file side and last line, oldest Comment first. */
export interface LineThread {
  readonly key: string;
  readonly path: string;
  readonly side: "new" | "old";
  readonly line: number;
  readonly comments: ReadonlyArray<LineComment>;
}

export const lineThreads = (comments: ReadonlyArray<SessionComment>): ReadonlyArray<LineThread> => {
  const threads = new Map<string, Array<LineComment>>();

  for (const c of comments.filter(onLines)) {
    const key = `${c.anchor.path}\u0000${c.anchor.side}\u0000${c.anchor.end}`;

    threads.set(key, [...(threads.get(key) ?? []), c]);
  }

  return [...threads].map(([key, list]) => ({
    key,
    path: list[0]!.anchor.path,
    side: list[0]!.anchor.side,
    line: list[0]!.anchor.end,
    comments: list,
  }));
};

/** Where a Comment points, as a quoted card in its Turn says it: "on sum_tree.rs:24". */
export const anchorPlace = (comment: SessionComment, harnessName: string | null): string => {
  if (onMessage(comment)) return `on ${harnessName ?? "the agent"}'s message`;

  if (!onLines(comment)) return "";
  const { path, start, end } = comment.anchor;
  const file = path.slice(path.lastIndexOf("/") + 1);

  return `on ${file}:${start === end ? start : `${start}–${end}`}`;
};

/**
 * Where `quote` sits in the message's text, for a `MessageText` anchor: its first occurrence,
 * else the first with whitespace collapsed; null when the rendered text doesn't map back.
 */
export const quoteRange = (
  text: string,
  quote: string
): { readonly start: number; readonly end: number } | null => {
  const exact = text.indexOf(quote);

  if (exact !== -1) return { start: exact, end: exact + quote.length };
  const words = quote.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return null;

  const pattern = new RegExp(
    words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s*_`~>#-]+")
  );

  const match = pattern.exec(text);

  return match === null ? null : { start: match.index, end: match.index + match[0].length };
};
