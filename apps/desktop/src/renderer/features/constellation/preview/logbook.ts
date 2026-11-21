/**
 * A stand-in Logbook for previews (Paper L1–L3): B1's two Attempts and its Inspection, B5's
 * lost Attempt, and entries across Tasks for the feed. Notes written in the preview land here.
 */
import { CheckReceipt, LogbookPage } from "@polaris/protocol";
import { Schema } from "effect";
import type { SubscriptionListener } from "../../../../shared/api.ts";
import type { Outcome } from "../client.ts";
import type { PageData } from "../model/logbook.ts";
import { CONSTELLATION, DEVBOX, STUDIO, worker } from "./graph.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let sequence = 0;

/** An entry as written, before it is decoded with its page; each kind adds its own fields. */
interface Raw {
  readonly _tag: string;
  readonly id: string;
  readonly sequence: number;
  readonly taskId: string;
  readonly at: string;
}

/** An entry `minutes` ago on `taskId`'s Attempt `n` (null before its first). */
const at = <R extends { readonly text: string }>(
  minutes: number,
  taskId: string,
  n: number | null,
  author: string,
  tag: string,
  rest: R
): Raw => {
  sequence += 1;

  const raw = {
    id: `${sequence}:${taskId}`,
    sequence,
    taskId,
    attemptId: n === null ? null : `att-${taskId}-${n}`,
    attempt: n,
    at: ago(minutes),
    author,
    ...rest,
    _tag: tag,
  };

  return raw;
};

const boundary = (
  taskId: string,
  n: number,
  spec: {
    readonly cause: string;
    readonly harness: string | null;
    readonly model: string | null;
    readonly state: string;
    readonly from: number;
    readonly to: number | null;
    readonly host?: string;
  }
) => {
  sequence += 1;

  return {
    taskId,
    attemptId: `att-${taskId}-${n}`,
    number: n,
    cause: spec.cause,
    sessionId: n === 2 ? worker(taskId) : `${worker(taskId)}-${n}`,
    hostId: spec.host ?? STUDIO,
    harness: spec.harness,
    model: spec.model,
    state: spec.state,
    sequence,
    startedAt: ago(spec.from),
    endedAt: spec.to === null ? null : ago(spec.to),
  };
};

const claim = (
  head: string,
  checks: ReadonlyArray<readonly [string, number]>,
  notDone: number
) => ({
  branch: "b1-quint-properties",
  head,
  commits: ["c1", "c2", "c3"].slice(0, notDone === 0 ? 3 : 2),
  receipts: checks.map(([label, exitCode]) =>
    CheckReceipt.cases.Reported.make({
      label,
      text: `${label} ${exitCode === 0 ? "passed" : "failed"}`,
      command: `bun run ${label}`,
      exitCode,
    })
  ),
  notDone: Array.from({ length: notDone }, () => "Trace validation on the handover log"),
  followups: [],
  questions: [],
  outsideArea: [],
  decisions: [],
  summary: "Quint properties",
});

const B1_HANDOVER =
  "Should a handover reset each Client feed's cursor, or carry it to the new lead?";

/** Sequences follow time, as a real fold's do; a boundary comes just before its entries. */
const renumber = (
  attempts: ReadonlyArray<ReturnType<typeof boundary>>,
  entries: ReadonlyArray<Raw>
) => {
  const time = (x: { readonly at: string } | { readonly startedAt: string }) =>
    "at" in x ? Date.parse(x.at) : Date.parse(x.startedAt) - 1;

  const all = [...attempts, ...entries].toSorted((a, b) => time(a) - time(b));
  const next = new Map(all.map((x, n) => [x, n + 1]));

  sequence = all.length;

  return {
    attempts: attempts.map((a) => ({ ...a, sequence: next.get(a) ?? 0 })),
    entries: entries
      .map((e) => ({ ...e, sequence: next.get(e) ?? 0, id: `${next.get(e) ?? 0}:${e.taskId}` }))
      .toSorted((a, b) => a.sequence - b.sequence),
  };
};

/** Built once, so ids and sequences match a real fold. */
const build = () => {
  sequence = 0;
  const attempts: Array<ReturnType<typeof boundary>> = [];
  const entries: Array<Raw> = [];
  const add = (...e: Array<Raw>) => entries.push(...e);

  add(
    at(140, "B1", null, "lead", "Brief", {
      title: "Quint properties for commits, streams, Client feeds and approvals",
      criteria: ["Each property names its invariant", "Trace validation passes on every log"],
      text: "Specify commit, stream and approval properties in polaris.qnt and check them against the model-based tests. Leave the engine alone.",
    }),
    at(128, "A2", 1, "lead", "Review", {
      outcome: "accepted",
      mergedHead: "c81e5a0d2",
      text: "Accepted c81e5a0 · glossary terms for logbook, inspection and inspector",
    })
  );
  attempts.push(
    boundary("B1", 1, {
      cause: "Initial",
      harness: "codex",
      model: "gpt-6.1-sol",
      state: "rejected",
      from: 125,
      to: 80,
    })
  );
  add(
    at(100, "B1", 1, "worker", "Progress", {
      completed: 2,
      total: 3,
      text: "Commits and streams typecheck; approvals next. Skipping Apalache for now, the simulator reaches depth 12 in under a minute.",
    }),
    at(81, "B1", 1, "worker", "Claim", {
      claim: claim(
        "3f9c2e1ab",
        [
          ["spec", 0],
          ["tests", 0],
          ["trace", 1],
        ],
        1
      ),
      amends: null,
      text: "",
    }),
    at(78, "B1", 1, "lead", "Review", {
      outcome: "sent_back",
      mergedHead: null,
      text: "Trace validation fails on the handover log: the spec has no handover action, so every trace after a handover is rejected. Add the action and claim again.",
    })
  );
  attempts.push(
    boundary("B1", 2, {
      cause: "SentBack",
      harness: "codex",
      model: "gpt-6.1-sol",
      state: "review",
      from: 76,
      to: null,
    })
  );
  add(
    at(58, "B1", 2, "worker", "Question", {
      question: { id: "q-b1-cursor", to: "lead", text: B1_HANDOVER, blocking: true },
      text: `${B1_HANDOVER} The spec README says both.`,
    }),
    at(55, "B1", 2, "lead", "Answer", {
      questionId: "q-b1-cursor",
      text: "Carry it. A Client resumes from its cursor whichever lead is current; fix the README while you're there.",
    }),
    at(41, "B1", 2, "you", "Note", {
      noteId: "n-1",
      text: "Yesterday's Pi trace has two handovers inside one lead turn: traces/raspberry-pi-4/2026-11-19-handover-twice.ndjson. Worth a scenario test.",
    }),
    at(33, "B1", 2, "worker", "Message", {
      channel: "peer",
      peer: "B4",
      outgoing: false,
      text: "The HTTP endpoint now emits a handover as two events, lead.ended then lead.started. Does your action expect one?",
    }),
    at(29, "B1", 2, "worker", "Progress", {
      completed: null,
      total: null,
      text: "Handover is two actions now, as B4 emits it. Trace validation passes on all 41 logs, the Pi one included.",
    }),
    at(14, "B4", 1, "worker", "Progress", {
      completed: 12,
      total: 14,
      text: "Handover endpoint passes the contract suite; 2 of 14 cases skipped until B1 lands.",
    }),
    at(12, "B1", 2, "worker", "Claim", {
      claim: claim(
        "7a1d04b9e",
        [
          ["spec", 0],
          ["tests", 0],
          ["trace", 0],
        ],
        0
      ),
      amends: null,
      text: "",
    }),
    at(8, "B3", 1, "you", "Note", {
      noteId: "n-2",
      text: "Keep each Pi run under 15 minutes; the sightline tests share that board at night.",
    }),
    at(3, "B1", 2, "inspector", "Inspection", {
      verdict: "approve",
      route: "lead",
      nextAttempt: null,
      text: "The handover actions and their invariant match the brief, the diff stays inside the Area, and all three checks pass when re-run on the claimed head. One gap: the new scenario test isn't in the README mapping.",
    })
  );

  // B5: sent back, then lost after a silence, then redispatched on the Mac Studio.
  attempts.push(
    boundary("B5", 1, {
      cause: "Initial",
      harness: "codex",
      model: "gpt-6.1-sol",
      state: "rejected",
      from: 180,
      to: 112,
    })
  );

  for (const [m, text] of [
    [178, "Reading the handover log format and the existing trace validator."],
    [160, "The validator builds; 0 of 5 recorded traces pass yet."],
    [150, "Adding the handover action to the replay."],
    [140, "2 of 5 traces pass; the other three stop at the first handover."],
    [130, "Blocked on B1's handover action; claiming what passes."],
  ] as const)
    add(at(m, "B5", 1, "worker", "Progress", { completed: null, total: null, text }));
  add(
    at(113, "B5", 1, "inspector", "Inspection", {
      verdict: "send_back",
      route: "sent_back",
      nextAttempt: 2,
      text: "2b77e90: the validator rejects every trace with a handover in it; the spec needs the action first (B1).",
    })
  );
  attempts.push(
    boundary("B5", 2, {
      cause: "SentBack",
      harness: "codex",
      model: "gpt-6.1-sol",
      state: "lost",
      from: 110,
      to: 38,
      host: DEVBOX,
    })
  );
  add(
    at(61, "B5", 2, "worker", "Progress", {
      completed: 3,
      total: 5,
      text: "The validator reads the handover log now; 3 of 5 recorded traces pass.",
    }),
    at(53, "B5", 2, "worker", "Progress", {
      completed: null,
      total: null,
      text: "Replaying the 2,400-event recording from apps/daemon/src/verification/fixtures/handover-2026-11-19-lucas-rpi.jsonl on the Pi 4; this takes a while.",
    }),
    at(38, "B5", 2, "polaris", "Lost", {
      outcome: "lost",
      failureKind: null,
      resetsAt: null,
      text: "after 10 min silent · stopped notice unanswered. Lease released; the branch keeps 2 unclaimed commits at 4e90c3d.",
    })
  );
  attempts.push(
    boundary("B5", 3, {
      cause: "Recover",
      harness: "claude",
      model: "opus 5.5",
      state: "working",
      from: 37,
      to: null,
    })
  );
  add(
    at(37, "B5", 3, "lead", "Brief", {
      title: "Trace validation for the handover log across every Client feed and resume",
      criteria: [],
      text: "Start from 4e90c3d. Read attempts 1 and 2 in this logbook first: attempt 1 was sent back for the missing handover action, attempt 2 stalled inside the 2,400-event replay. Run the replay on the Mac Studio and post progress every 5 minutes.",
    }),
    at(2, "B5", 3, "worker", "Progress", {
      completed: 1850,
      total: 2400,
      text: "Replay at 1,850 of 2,400 events, no rejections so far.",
    })
  );

  return renumber(attempts, entries);
};

const decode = Schema.decodeUnknownSync(LogbookPage);

let log = build();

/** Long content: a note with no spaces and a long one, for break checks. */
export const addLongEntries = () => {
  log.entries.push(
    at(1, "B1", 2, "you", "Note", {
      noteId: "n-long",
      text: `${"A long note that keeps going so it has to wrap across several lines of the logbook. ".repeat(4)}apps/daemon/src/verification/fixtures/handover-replay-across-every-client-feed-and-resume-with-no-spaces.jsonl`,
    })
  );
};

const pageOf = (taskId: string | null, entries: ReadonlyArray<Raw>): PageData =>
  decode({
    constellationId: CONSTELLATION,
    taskId,
    attempts: log.attempts.filter((a) => taskId === null || a.taskId === taskId),
    entries: entries.filter((e) => taskId === null || e.taskId === taskId),
    cursor: sequence,
  });

interface Watcher {
  readonly taskId: string | null;
  readonly listener: SubscriptionListener<PageData>;
}

const watchers = new Set<Watcher>();

export const resetLogbook = () => {
  log = build();
};

export const subscribeLogbook = (
  input: { readonly taskId?: string },
  listener: SubscriptionListener<PageData>
) => {
  const watcher: Watcher = { taskId: input.taskId ?? null, listener };

  watchers.add(watcher);
  queueMicrotask(() => listener.items([pageOf(watcher.taskId, log.entries)]));

  return () => {
    watchers.delete(watcher);
  };
};

/** The decider's Note: a `you` entry on the Task's latest Attempt, pushed to every reader. */
export const fakeNote = (input: { readonly taskId: string; readonly text: string }): Outcome => {
  const latest = log.attempts.filter((a) => a.taskId === input.taskId).at(-1) ?? null;

  const entry = at(0, input.taskId, latest?.number ?? null, "you", "Note", {
    noteId: `n-${sequence + 1}`,
    text: input.text,
  });

  log.entries.push(entry);

  for (const w of watchers) w.listener.items([pageOf(w.taskId, [entry])]);

  return { ok: true, summary: "Noted" };
};

/** The whole fixture as one page, for tests. */
export const fixturePage = (taskId: string | null): PageData => pageOf(taskId, log.entries);
