import { expect, test } from "bun:test";
import {
  AgentSession,
  ApprovalRequest,
  RequestId,
  TurnId,
  DomainEvent,
  EventEnvelope,
  type HostStreamItem,
  Sequence,
  SessionId,
  SessionStreamItem,
  WorkspaceId,
} from "@polaris/protocol";
import { Deferred, Effect, Predicate, Stream } from "effect";
import { applyHostItems, emptyHostModel } from "../../renderer/store/hostModel.ts";
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

const sessionEvent = (sequence: number, event: DomainEvent) =>
  SessionStreamItem.cases.Event.make({
    envelope: new EventEnvelope({
      sequence: Sequence.make(sequence),
      occurredAt: at,
      commandId: null,
      event,
    }),
  });

const approval = new ApprovalRequest({
  id: RequestId.make("r1"),
  sessionId: SessionId.make("a"),
  turnId: TurnId.make("t1"),
  kind: "command",
  title: "Run bun test",
  detail: null,
  options: [],
  openedAt: at,
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

  const model = applyHostItems(emptyHostModel, items);

  expect([...model.sessions.values()].map((e) => e.session.title).toSorted()).toEqual([
    "Docs pass",
    "Fix login flow",
  ]);
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

test("a later session's Snapshot keeps an earlier session's live state and approvals", async () => {
  const gate = Effect.runSync(Deferred.make<void>());

  const a = Stream.make(
    snapshot("a", "Fix login", 10),
    sessionEvent(
      11,
      DomainEvent.cases.SessionStateChanged.make({
        sessionId: SessionId.make("a"),
        state: "working",
        reason: null,
      })
    ),
    sessionEvent(12, DomainEvent.cases.ApprovalRequested.make({ request: approval }))
  ).pipe(Stream.concat(Stream.fromEffect(Deferred.succeed(gate, undefined)).pipe(Stream.drain)));

  const b = Stream.fromEffect(Deferred.await(gate)).pipe(
    Stream.flatMap(() => Stream.make(snapshot("b", "Docs", 4)))
  );

  const items = await Effect.runPromise(
    Stream.runCollect(
      teammateHostFeed([SessionId.make("a"), SessionId.make("b")], (id) => (id === "a" ? a : b))
    )
  );

  const model = applyHostItems(emptyHostModel, items);
  const entryA = model.sessions.get("a");

  expect(entryA?.session.state).toBe("working");
  expect(entryA?.pendingApprovals.map((r) => String(r.id))).toEqual(["r1"]);
  expect(model.sessions.get("b")?.session.title).toBe("Docs");
});
