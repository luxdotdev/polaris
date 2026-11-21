/** A Logbook as text: one line per entry, and the capped digest a new Attempt's first Turn carries. */
import type { Attempt, Constellation, LogbookEntry, LogbookPage } from "@polaris/protocol";
import { Effect, Match, Predicate } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { readLogbook } from "../logbook/index.ts";

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const said = (text: string) => (flat(text) === "" ? "" : `: ${flat(text)}`);

const what = (entry: LogbookEntry) =>
  Match.value(entry).pipe(
    Match.tag("Brief", (e) => `brief · ${flat(e.title)}${said(e.text)}`),
    Match.tag(
      "Progress",
      (e) =>
        `progress${e.completed === null ? "" : ` ${e.completed}/${e.total ?? "?"}`}${said(e.text)}`
    ),
    Match.tag(
      "Question",
      (e) => `asks ${e.question.to} (questionId ${e.question.id})${said(e.text)}`
    ),
    Match.tag("Answer", (e) => `answers ${e.questionId}${said(e.text)}`),
    Match.tag("Message", (e) => {
      if (e.channel === "operator") return `message${said(e.text)}`;

      return `${e.outgoing ? "to" : "from"} ${e.peer ?? "a peer"}${said(e.text)}`;
    }),
    Match.tag("Claim", (e) => `claims ${e.claim.head}${said(e.text)}`),
    Match.tag("Review", (e) =>
      Match.value(e.outcome).pipe(
        Match.when("approved", () => "approved the Claim"),
        Match.when("accepted", () => `accepted ${e.mergedHead ?? ""}${said(e.text)}`.trim()),
        Match.when("handed_up", () => `handed the Claim to the user${said(e.text)}`),
        Match.when("sent_back", () => `sent back${said(e.text)}`),
        Match.exhaustive
      )
    ),
    Match.tag("Inspection", (e) => `inspection ${e.verdict} (${e.route})${said(e.text)}`),
    Match.tag(
      "Lost",
      (e) => `${e.outcome}${e.failureKind === null ? "" : ` (${e.failureKind})`}${said(e.text)}`
    ),
    Match.tag("Note", (e) => `note${said(e.text)}`),
    Match.exhaustive
  );

/** `#42 · Attempt 1 · lead · note: Watch the cursor.` */
export const logbookLine = (entry: LogbookEntry) =>
  `#${entry.sequence} · ${entry.attempt === null ? "before any Attempt" : `Attempt ${entry.attempt}`} · ${entry.author} · ${what(entry)}`;

/** The rows a new Attempt needs: what was asked and answered, why it was sent back or lost, and notes. */
const carried = (entry: LogbookEntry) =>
  Predicate.isTagged(entry, "Question") ||
  Predicate.isTagged(entry, "Answer") ||
  Predicate.isTagged(entry, "Note") ||
  Predicate.isTagged(entry, "Lost") ||
  Predicate.isTagged(entry, "Inspection") ||
  (Predicate.isTagged(entry, "Message") && entry.channel === "operator") ||
  (Predicate.isTagged(entry, "Review") &&
    (entry.outcome === "sent_back" || entry.outcome === "handed_up"));

/** At most `entries` lines and `chars` characters in all; each line is cut at `line` characters. */
export interface DigestCap {
  readonly entries: number;
  readonly chars: number;
  readonly line: number;
}

export const DIGEST_CAP: DigestCap = { entries: 20, chars: 4000, line: 600 };

const clip = (text: string, chars: number) =>
  text.length <= chars ? text : `${text.slice(0, Math.max(0, chars - 1))}…`;

/**
 * The entries since the previous Attempt started, newest kept first within the cap and shown
 * oldest first; a last line counts what was left out and how to read it.
 */
export const attemptDigest = (
  page: LogbookPage,
  previous: Attempt,
  cap: DigestCap = DIGEST_CAP
): string => {
  const boundary = page.attempts.find((a) => a.attemptId === previous.id);

  if (boundary === undefined) return "";
  const since = boundary.sequence;
  const entries = page.entries.filter((e) => e.sequence > since && carried(e));

  if (entries.length === 0) return "";

  const kept: Array<string> = [];
  let used = 0;

  for (const entry of entries.toReversed()) {
    if (kept.length >= cap.entries) break;
    const line = clip(logbookLine(entry), Math.min(cap.line, cap.chars));

    if (used + line.length > cap.chars) break;
    kept.push(line);
    used += line.length;
  }

  const dropped = entries.length - kept.length;

  return [
    `Logbook since Attempt ${boundary.number} started (${previous.id}), oldest first:`,
    ...kept.toReversed(),
    ...(dropped === 0
      ? []
      : [
          `${dropped} earlier ${dropped === 1 ? "entry was" : "entries were"} left out; logbook_read { task: ${page.taskId ?? previous.taskId}, since: ${since} } has the rest.`,
        ]),
  ].join("\n");
};

/** The digest for `attempt`'s first Turn, read as its own worker; empty for a first Attempt. */
export const firstTurnDigest = Effect.fn("Constellation.firstTurnDigest")(function* (
  graph: Pick<Constellation, "id" | "attempts">,
  attempt: Attempt
) {
  if (!("ref" in attempt.cause)) return "";
  const ref = attempt.cause.ref;
  const previous = graph.attempts.find((a) => a.id === ref);

  if (previous === undefined) return "";

  const store = yield* EventStore;

  return yield* readLogbook(
    store,
    { kind: "session", sessionId: attempt.sessionId },
    { constellationId: graph.id, taskId: attempt.taskId }
  ).pipe(
    Effect.map((page) => attemptDigest(page, previous)),
    // The digest is a convenience: a refused read leaves the brief as it was.
    Effect.catchTag("ConstellationRejected", () => Effect.succeed(""))
  );
});
