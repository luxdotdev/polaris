/**
 * Co-author trailers for Teammates (ENG-941): who contributed to a set of Turns, the
 * `Co-authored-by` lines that credit them, and adding the missing ones to a message.
 */
import type { Actor, Comment, CommentId, Turn, TurnId } from "@polaris/protocol";
import { Predicate } from "effect";

export type TeammateActor = Extract<Actor, { readonly _tag: "Teammate" }>;

/** How a Teammate is credited: their Account's display name and commit email. */
export interface CommitIdentity {
  readonly name: string;
  readonly email: string;
}

/**
 * The Teammates who contributed to `turns`, in order of first contribution: whoever sent a
 * Turn, then the authors of the Comments it carried. Watching earns nothing.
 */
export const contributors = (
  turns: ReadonlyArray<Pick<Turn, "id" | "commentIds">>,
  actors: ReadonlyMap<TurnId, Actor>,
  comments: ReadonlyMap<CommentId, Comment> | undefined
): ReadonlyArray<TeammateActor> => {
  const found = new Map<string, TeammateActor>();

  const add = (actor: Actor | undefined) => {
    if (actor !== undefined && Predicate.isTagged(actor, "Teammate") && !found.has(actor.personId))
      found.set(actor.personId, actor);
  };

  for (const turn of turns) {
    add(actors.get(turn.id));

    for (const id of turn.commentIds ?? []) add(comments?.get(id)?.author);
  }

  return [...found.values()];
};

const clean = (text: string) =>
  text
    .replaceAll(/[\r\n<>]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

const TRAILER = /^co-authored-by:[^<\n]*<([^>\n]+)>\s*$/gim;

const emailsIn = (text: string): ReadonlySet<string> =>
  new Set([...text.matchAll(TRAILER)].map((m) => (m[1] ?? "").trim().toLowerCase()));

/** One `Co-authored-by` line per email, first name wins; identities without an email are skipped. */
export const coAuthorTrailers = (
  identities: ReadonlyArray<CommitIdentity | null>
): ReadonlyArray<string> => {
  const byEmail = new Map<string, string>();

  for (const identity of identities) {
    const email = identity === null ? "" : clean(identity.email);

    if (identity === null || email === "" || byEmail.has(email.toLowerCase())) continue;
    byEmail.set(email.toLowerCase(), `Co-authored-by: ${clean(identity.name) || email} <${email}>`);
  }

  return [...byEmail.values()];
};

const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*: \S/;

/**
 * `message` with the trailers it lacks (compared by email, case-insensitively) at its end: in
 * its trailer block when it ends with one, else after a blank line. Unchanged when none lack.
 */
export const withTrailers = (message: string, trailers: ReadonlyArray<string>): string => {
  const present = emailsIn(message);

  const missing = trailers.filter((t) => {
    const email = [...t.matchAll(TRAILER)][0]?.[1]?.trim().toLowerCase();

    return email !== undefined && !present.has(email);
  });

  if (missing.length === 0) return message;
  const body = message.trimEnd();
  const lastParagraph = body.split(/\n\s*\n/).at(-1) ?? "";
  const paragraphs = body.split(/\n\s*\n/).length;

  const inBlock =
    paragraphs > 1 && lastParagraph.split("\n").every((line) => TRAILER_LINE.test(line));

  const ending = message.endsWith("\n") ? "\n" : "";

  if (body === "") return `${missing.join("\n")}${ending}`;

  return `${body}${inBlock ? "\n" : "\n\n"}${missing.join("\n")}${ending}`;
};

/** The note a shared session's agent gets with each Turn, naming the trailers it must keep. */
export const coAuthorNote = (trailers: ReadonlyArray<string>): string =>
  [
    "Polaris: teammates have contributed to this session. When you write a commit message,",
    "end it with these trailers, after a blank line, each on its own line:",
    ...trailers,
  ].join("\n");
