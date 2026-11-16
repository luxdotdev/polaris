/**
 * A shared Agent Session as the phone shows it (DESIGN.md "Shared Sessions", Paper SS6): who
 * wrote each Turn and Comment, as the viewer reads it, a Comment's marks, where Comments sit on
 * messages and steps, and what a Commenter's composer says.
 */
import { Actor, type Comment, CommentAnchor, type ShareRole } from "@polaris/protocol";
import { Predicate } from "effect";
import type { TurnEntry } from "../thread/fold.ts";

/** Who is looking: the owner on one of their own devices, or a Teammate through their Share. */
export type Viewer =
  | { readonly kind: "owner" }
  | {
      readonly kind: "teammate";
      readonly personId: string;
      readonly role: ShareRole;
      /** The owner's name, as the Invite named them. */
      readonly ownerName: string;
    };

export const OWNER: Viewer = { kind: "owner" };

const isTeammate = (actor: Actor | null | undefined) =>
  actor != null && Predicate.isTagged(actor, "Teammate");

/**
 * Whether sharing shows in this session: the viewer is a Teammate, or a Teammate sent a Turn, wrote
 * or resolved a Comment. Otherwise nothing does (DESIGN.md, rule/solo-is-unchanged).
 */
export const showsSharing = (
  viewer: Viewer,
  turns: ReadonlyArray<TurnEntry>,
  comments: ReadonlyArray<Comment>
): boolean =>
  viewer.kind === "teammate" ||
  turns.some((entry) => isTeammate(entry.turn.actor)) ||
  comments.some((c) => isTeammate(c.author) || isTeammate(c.resolvedBy));

/** A person as a byline shows them: "You", "Lucas Doell", or "from Raycast" for an Extension. */
export interface Byline {
  readonly label: string;
  /** Up to two letters for the avatar; empty for an Extension. */
  readonly initials: string;
}

export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0] ?? ""];

  return letters
    .map((word) => (word ?? "").charAt(0))
    .join("")
    .toUpperCase();
};

/** The owner's Clients and Linked Devices are one person: "You" to the owner, their name to a Teammate. */
const ownerByline = (viewer: Viewer): Byline =>
  viewer.kind === "owner"
    ? { label: "You", initials: "" }
    : { label: viewer.ownerName, initials: initialsOf(viewer.ownerName) };

export const bylineOf = (actor: Actor, viewer: Viewer): Byline =>
  Actor.match(actor, {
    Client: () => ownerByline(viewer),
    LinkedDevice: () => ownerByline(viewer),
    Extension: (a) => ({ label: `from ${a.name}`, initials: "" }),
    Teammate: (a) =>
      viewer.kind === "teammate" && viewer.personId === a.personId
        ? { label: "You", initials: initialsOf(a.name) }
        : { label: a.name, initials: initialsOf(a.name) },
  });

/** A Comment's author: as a byline, without "from" for an Extension. */
export const authorName = (actor: Actor, viewer: Viewer): string =>
  Predicate.isTagged(actor, "Extension") ? actor.name : bylineOf(actor, viewer).label;

/** The UI's Turn number for a Turn id ("turn 25"), or null for one not loaded. */
export const turnNumberOf =
  (turns: ReadonlyArray<TurnEntry>) =>
  (turnId: string | null | undefined): number | null => {
    if (turnId == null) return null;
    const turn = turns.find((entry) => entry.turn.id === turnId)?.turn;

    return turn === undefined ? null : (turn.userTurnNumber ?? turn.index + 1);
  };

type TurnNumber = (turnId: string | null | undefined) => number | null;

/** Its marks after the author: "Sent with turn 25", "Outdated", "Resolved". */
export const commentMarks = (comment: Comment, turnNumber: TurnNumber): ReadonlyArray<string> => {
  const marks: Array<string> = [];

  if (comment.sentInTurnId != null) {
    const sent = turnNumber(comment.sentInTurnId);
    marks.push(sent === null ? "Sent" : `Sent with turn ${sent}`);
  }

  if (comment.outdatedInTurnId != null) marks.push("Outdated");

  if (comment.resolvedAt != null) marks.push("Resolved");

  return marks;
};

/** Comments neither sent nor resolved: what "Send as a turn" carries. */
export const unsentComments = (comments: ReadonlyArray<Comment>) =>
  comments.filter((c) => c.sentInTurnId == null && c.resolvedAt == null);

type MessageAnchor = Extract<CommentAnchor, { readonly _tag: "MessageText" }>;

type LinesAnchor = Extract<CommentAnchor, { readonly _tag: "DiffLines" }>;

const messageAnchorOf = (c: Comment): MessageAnchor | null =>
  Predicate.isTagged(c.anchor, "MessageText") ? c.anchor : null;

const linesAnchorOf = (c: Comment): LinesAnchor | null =>
  Predicate.isTagged(c.anchor, "DiffLines") ? c.anchor : null;

/** A message's Comments, oldest first. */
export const messageComments = (comments: ReadonlyArray<Comment>, messageId: string) =>
  comments.filter((c) => messageAnchorOf(c)?.messageId === messageId);

/** A step's file is named as the Harness gave it (often absolute); a diff's path is from the repository top. */
const samePath = (stepPath: string, diffPath: string) =>
  stepPath === diffPath || stepPath.endsWith(`/${diffPath}`);

/** The line Comments on the files a step of `turnId` changed, oldest first. */
export const stepComments = (
  comments: ReadonlyArray<Comment>,
  turnId: string,
  paths: ReadonlyArray<string>
) =>
  comments.filter((c) => {
    const anchor = linesAnchorOf(c);

    return (
      anchor !== null &&
      anchor.turnId === turnId &&
      paths.some((path) => samePath(path, anchor.path))
    );
  });

/** Line Comments as threads, one per file side and line range, oldest Comment first. */
export interface LineThread {
  readonly key: string;
  /** "serve.ts:4", "serve.ts:4–9", with "(removed)" for the old side. */
  readonly place: string;
  readonly code: string;
  /** The first Comment's anchor: a reply is anchored where the thread is. */
  readonly anchor: LinesAnchor;
  readonly comments: ReadonlyArray<Comment>;
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const linesPlace = (anchor: LinesAnchor) =>
  `${basename(anchor.path)}:${anchor.start === anchor.end ? anchor.start : `${anchor.start}–${anchor.end}`}${anchor.side === "old" ? " (removed)" : ""}`;

export const lineThreads = (comments: ReadonlyArray<Comment>): ReadonlyArray<LineThread> => {
  const threads = new Map<string, { anchor: LinesAnchor; comments: Array<Comment> }>();

  for (const c of comments) {
    const anchor = linesAnchorOf(c);

    if (anchor === null) continue;
    const key = [anchor.path, anchor.side, anchor.start, anchor.end].join("\u0000");
    const held = threads.get(key);

    if (held === undefined) threads.set(key, { anchor, comments: [c] });
    else held.comments.push(c);
  }

  return [...threads].map(([key, { anchor, comments: list }]) => ({
    key,
    place: linesPlace(anchor),
    code: anchor.code,
    anchor,
    comments: list,
  }));
};

/** Where a Comment points, as its card in a Turn says it: "on serve.ts:4", "on Claude Code's message". */
export const anchorPlace = (comment: Comment, harnessName: string): string =>
  CommentAnchor.match(comment.anchor, {
    MessageText: () => `on ${harnessName}'s message`,
    DiffLines: (anchor) => `on ${linesPlace(anchor)}`,
  });

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The collapsed line under a message: "2 comments · Sent with turn 25" when one Turn carried them all. */
export const commentsLine = (comments: ReadonlyArray<Comment>, turnNumber: TurnNumber): string => {
  const sent = new Set(comments.map((c) => c.sentInTurnId ?? null));
  const [only] = sent;
  const number = sent.size === 1 && only !== null ? turnNumber(only) : null;

  return [plural(comments.length, "comment"), number === null ? null : `Sent with turn ${number}`]
    .filter((part) => part !== null)
    .join(" · ");
};

/** Owners and Contributors send Turns; a Commenter only comments. */
export const sendsTurns = (viewer: Viewer) =>
  viewer.kind === "owner" || viewer.role === "contributor";

/** Who may resolve a Comment (ADR 0113): its author, the owner, or a Contributor. */
export const mayResolve = (comment: Comment, viewer: Viewer) =>
  sendsTurns(viewer) ||
  (viewer.kind === "teammate" &&
    Predicate.isTagged(comment.author, "Teammate") &&
    comment.author.personId === viewer.personId);

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Under a Commenter's composer (SS6). */
export const commenterNote = (ownerName: string) =>
  `As a commenter, you comment; turns come from ${firstName(ownerName)} and contributors.`;

const QUOTE_LIMIT = 48;

/** The composer's quote line: `Comment on "Starting on variant 4."`, a long one cut short. */
export const commentOnLabel = (quote: string) => {
  const line = quote.trim().replace(/\s+/g, " ");

  return `Comment on "${line.length > QUOTE_LIMIT ? `${line.slice(0, QUOTE_LIMIT - 1)}…` : line}"`;
};

/** The role chip a Teammate sees in place of Share. */
export const roleWord = (role: ShareRole) => (role === "contributor" ? "Contributor" : "Commenter");
