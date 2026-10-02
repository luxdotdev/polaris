/**
 * The Stats popover (spec §9): what the graph alone tells, computed when viewed. Tokens and
 * cost per Task come from Usage (the telemetry slice); the popover says so rather than guess.
 */
import { Match, Predicate } from "effect";
import { pluralize, span } from "./copy.ts";
import type { AttemptData, ConstellationRecord } from "./types.ts";

export interface StatLine {
  readonly label: string;
  readonly value: string;
}

export interface StatGroup {
  readonly title: string;
  readonly lines: ReadonlyArray<StatLine>;
}

const MINUTE = 60_000;

const minutes = (ms: number) => {
  const m = Math.round(ms / MINUTE);

  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const causeWord = (a: AttemptData) =>
  Match.value(a.cause).pipe(
    Match.tagsExhaustive({
      Initial: () => null,
      SentBack: () => "sent back",
      MergeConflict: () => "merge conflict",
      Recover: () => "recovered",
      Followup: () => "follow-up",
      Superseded: () => "superseded",
    })
  );

const median = (values: ReadonlyArray<number>) => {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

const reviewLines = (r: ConstellationRecord, now: number): ReadonlyArray<StatLine> => {
  const { attempts } = r.constellation;

  const waits = attempts.flatMap((a) => {
    const claimed = a.claimedAt;
    const decided = a.state === "review" ? now : a.endedAt == null ? null : Date.parse(a.endedAt);

    return claimed === null || decided === null ? [] : [decided - Date.parse(claimed)];
  });

  const firstTries = attempts.filter(
    (a) => Predicate.isTagged(a.cause, "Initial") && a.state === "accepted"
  );

  const accepted = attempts.filter((a) => a.state === "accepted").length;
  const causes = new Map<string, number>();

  for (const a of attempts) {
    const word = causeWord(a);

    if (word !== null) causes.set(word, (causes.get(word) ?? 0) + 1);
  }

  const wait = median(waits);

  return [
    { label: "Claim to review", value: wait === null ? "none yet" : `${minutes(wait)} median` },
    {
      label: "Accepted first time",
      value: accepted === 0 ? "none yet" : `${firstTries.length} of ${accepted}`,
    },
    {
      label: "New attempts",
      value:
        causes.size === 0 ? "none" : [...causes].map(([word, n]) => `${n} ${word}`).join(" · "),
    },
  ];
};

export const constellationStats = (
  r: ConstellationRecord,
  now: number
): ReadonlyArray<StatGroup> => {
  const c = r.constellation;
  const working = c.attempts.filter((a) => a.state === "working");

  const busy = c.attempts.reduce(
    (sum, a) => sum + ((a.endedAt == null ? now : Date.parse(a.endedAt)) - Date.parse(a.startedAt)),
    0
  );

  const items = r.digests.reduce((sum, d) => sum + d.items.length, 0);
  const ended = c.state === "completed" || c.state === "archived";

  return [
    {
      title: "Constellation",
      lines: [
        {
          label: "Running for",
          value: ended
            ? minutes(Date.parse(c.updatedAt) - Date.parse(c.createdAt))
            : span(c.createdAt, now),
        },
        { label: "Attempts", value: `${c.attempts.length} · ${working.length} working` },
      ],
    },
    {
      title: "Lead",
      lines: [
        { label: "Wakeups", value: pluralize(r.digests.length, "digest") },
        {
          label: "Updates per wakeup",
          value: r.digests.length === 0 ? "none yet" : (items / r.digests.length).toFixed(1),
        },
      ],
    },
    { title: "Review", lines: reviewLines(r, now) },
    { title: "Workers", lines: [{ label: "Time working", value: minutes(busy) }] },
  ];
};
