import { expect, test } from "bun:test";
import {
  AgentSession,
  DomainEvent,
  EventEnvelope,
  type HostStreamItem,
  Sequence,
  SessionId,
  SessionStreamItem,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect, Predicate, Stream } from "effect";
import { teammateHostFeed } from "./teammateFeed.ts";

const at = "2026-11-16T00:00:00.000Z";

const session = (id: string, title: string) =>
  new AgentSession({
    id: SessionId.make(id),
    workspaceId: WorkspaceId.make("w-owner"),
    harness: "claude",
    title,
    cwd: "/owner/repo",
    worktreeId: null,
    state: "idle",
    permissionMode: "auto",
    model: null,
    effort: null,
    serviceTier: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: at,
    updatedAt: at,
  });

const snapshot = (id: string, title: string, sequence: number) =>
  SessionStreamItem.cases.Snapshot.make({
    sequence: Sequence.make(sequence),
    session: session(id, title),
    turns: [],
    pendingApprovals: [],
  });

const renamed = (id: string, title: string, sequence: number) =>
  SessionStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(sequence),
      occurredAt: at,
      commandId: null,
      event: DomainEvent.cases.SessionRenamed.make({ sessionId: SessionId.make(id), title }),
    }),
  });

const sequenceOf = (item: HostStreamItem) =>
  Predicate.isTagged(item, "Event") ? item.envelope.sequence : item.sequence;

test("two shared sessions make one host feed whose sequence only rises", async () => {
  // The owner's Host numbers events globally: b's stream is behind a's.
  const streams = new Map([
    ["a", [snapshot("a", "Fix login", 90), renamed("a", "Fix login flow", 95)]],
    ["b", [snapshot("b", "Docs", 40), renamed("b", "Docs pass", 41)]],
  ]);

  const items = await Effect.runPromise(
    Stream.runCollect(
      teammateHostFeed([SessionId.make("a"), SessionId.make("b")], (id) =>
        Stream.fromIterable(streams.get(id) ?? [])
      )
    )
  );

  const sequences = items.map(sequenceOf);
  const rising = sequences.every((s, i) => i === 0 || s >= (sequences[i - 1] ?? 0));

  expect(rising).toBe(true);

  const titles = items.flatMap((item) =>
    Predicate.isTagged(item, "Event") && Predicate.isTagged(item.envelope.event, "SessionRenamed")
      ? [item.envelope.event.title]
      : []
  );

  expect(titles.toSorted()).toEqual(["Docs pass", "Fix login flow"]);

  const last = items.findLast((item) => Predicate.isTagged(item, "Snapshot"));

  expect(
    last !== undefined && Predicate.isTagged(last, "Snapshot")
      ? last.sessions.map((s) => s.session.title).toSorted()
      : []
  ).toEqual(["Docs", "Fix login"]);
});

test("a session the Host refuses drops out, and nothing is sent before a Snapshot", async () => {
  const items = await Effect.runPromise(
    Stream.runCollect(
      teammateHostFeed([SessionId.make("gone"), SessionId.make("a")], (id) =>
        id === "gone" ? Stream.fail("NotShared") : Stream.make(snapshot("a", "Fix login", 3))
      )
    )
  );

  expect(items[0] !== undefined && Predicate.isTagged(items[0], "Snapshot")).toBe(true);
  expect(
    items.flatMap((item) =>
      Predicate.isTagged(item, "Snapshot") ? item.sessions.map((s) => String(s.session.id)) : []
    )
  ).toEqual(["a"]);
});

test("an offline Host's feed sends nothing, so the cached history stays", async () => {
  const items = await Effect.runPromise(
    Stream.runCollect(
      teammateHostFeed([SessionId.make("a")], () => Stream.empty).pipe(Stream.take(1))
    )
  );

  expect(items).toEqual([]);
});
