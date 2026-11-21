import { describe, expect, test } from "bun:test";
import {
  AgentSession,
  CommandId,
  type ConstellationCommand,
  type ConstellationStreamItem,
  ConstellationSettings,
  DomainEvent,
  PlanOperation,
  ReviewAction,
  Sequence,
  SessionId,
  TaskId,
  WorkerPlacement,
  Workspace,
} from "@polaris/protocol";
import { Effect, Fiber, Layer, Predicate, Result, Stream } from "effect";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import {
  A,
  AT,
  B,
  C,
  CID,
  HOST,
  LEAD,
  WS,
  draft,
  report,
  task,
} from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationOwner, ConstellationRuntime } from "../runtime.ts";
import { Constellations } from "../service.ts";

const user = { kind: "user" as const };

const workerId = SessionId.make("worker");

const worker = { kind: "session" as const, sessionId: workerId };

const stranger = { kind: "session" as const, sessionId: SessionId.make("stranger") };

const session = (id: SessionId) =>
  new AgentSession({
    id,
    workspaceId: WS,
    harness: "codex",
    title: id,
    cwd: "/tmp",
    worktreeId: null,
    state: "idle",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  });

const layer = Constellations.layer.pipe(
  Layer.provideMerge(EventStore.layerSqlite(":memory:")),
  Layer.provide(Layer.succeed(ConstellationOwner)(HOST)),
  Layer.provide(
    Layer.succeed(ConstellationRuntime)({
      prepare: () =>
        Effect.succeed({
          attempts: [draft()],
          newLeadSessionId: null,
          claimProbe: { dirtyPaths: [], branch: "polaris/A", head: "head" },
          recordedChecks: [],
        }),
      afterCommit: () => Effect.void,
      resumeWorking: () => Effect.void,
    })
  )
);

let commands = 0;

/** A's worker has reported progress once; B has no Attempt. */
const working = Effect.gen(function* () {
  const store = yield* EventStore;
  const graphs = yield* Constellations;

  yield* store.commit({
    commandId: CommandId.make("seed"),
    decide: () =>
      Effect.succeed([
        DomainEvent.cases.WorkspaceRegistered.make({
          workspace: new Workspace({
            id: WS,
            path: "/tmp",
            name: "test",
            isGitRepo: true,
            worktreeRoot: "/tmp/trees",
            hidden: false,
            registeredAt: AT,
          }),
        }),
        DomainEvent.cases.SessionCreated.make({ session: session(LEAD) }),
        DomainEvent.cases.SessionCreated.make({ session: session(workerId) }),
      ]),
  });

  const send = (binding: ConstellationBinding, command: ConstellationCommand) =>
    graphs.command(binding, CommandId.make(`c${commands++}`), command);

  yield* send(
    user,
    C.Plan.make({
      constellationId: CID,
      start: {
        name: "Build",
        workspaceId: WS,
        leadSessionId: LEAD,
        settings: new ConstellationSettings({}),
      },
      operations: [task(A), task(B)].map((t) => PlanOperation.cases.Add.make({ task: t })),
    })
  );
  yield* send(
    user,
    C.Dispatch.make({
      constellationId: CID,
      tasks: [{ taskId: A, worker: WorkerPlacement.cases.Existing.make({ sessionId: workerId }) }],
    })
  );
  yield* send(
    worker,
    C.WorkerProgress.make({
      constellationId: CID,
      attemptId: draft().id,
      note: "Reading the store",
      completed: null,
      total: null,
      waiting: null,
    })
  );

  return { graphs, store, send };
});

const note = (text: string, taskId = A) => C.Note.make({ constellationId: CID, taskId, text });

const LOGBOOK = ["constellation", "constellation.logbook"] as const;

/** A stream item's note text, for the items that are notes. */
const noteText = (item: ConstellationStreamItem) =>
  Predicate.isTagged(item, "Event") && Predicate.isTagged(item.envelope.event, "LogbookNoted")
    ? Result.succeed(item.envelope.event.text)
    : Result.failVoid;

const run = <X, E>(effect: Effect.Effect<X, E, EventStore | Constellations>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));

const kinds = (page: { readonly entries: ReadonlyArray<{ readonly _tag: string }> }) =>
  page.entries.map((e) => e._tag);

describe("reading a Logbook from the store", () => {
  test("a read returns the Task's entries and its boundary; the next read from its cursor returns only what came after", () =>
    run(
      Effect.gen(function* () {
        const { graphs, send } = yield* working;
        const first = yield* graphs.logbook.read(user, { constellationId: CID, taskId: A });

        expect(kinds(first)).toEqual(["Brief", "Progress"]);
        // The boundary names the Harness of the worker's session on this Host.
        expect(first.attempts.map((a) => [a.number, a.state, a.harness])).toEqual([
          [1, "working", "codex"],
        ]);

        yield* send(worker, note("The cut is the store's sequence."));
        yield* send(user, note("B waits on the contract.", B));

        const next = yield* graphs.logbook.read(user, {
          constellationId: CID,
          taskId: A,
          since: first.cursor,
        });

        expect(next.entries.map((e) => [e._tag, e.author, e.text])).toEqual([
          ["Note", "worker", "The cut is the store's sequence."],
        ]);
        expect(next.cursor).toBeGreaterThan(first.cursor);

        const again = yield* graphs.logbook.read(user, {
          constellationId: CID,
          taskId: A,
          since: next.cursor,
        });

        expect(again.entries).toEqual([]);
      })
    ));

  test("a session that may not read the Task is refused, and so is a write through the service", () =>
    run(
      Effect.gen(function* () {
        const { graphs, send } = yield* working;

        const code = <X>(
          effect: Effect.Effect<X, { readonly findings: ReadonlyArray<{ readonly code: string }> }>
        ) =>
          effect.pipe(
            Effect.as("allowed"),
            Effect.catch((error) => Effect.succeed(error.findings[0]?.code))
          );

        // What a refused reader is told: the finding, and nothing of the graph it may not read.
        const told = (binding: ConstellationBinding, taskId?: typeof A) =>
          graphs.logbook
            .read(
              binding,
              taskId === undefined ? { constellationId: CID } : { constellationId: CID, taskId }
            )
            .pipe(
              Effect.as(null),
              Effect.catchTag("ConstellationRejected", (e) =>
                Effect.succeed({ code: e.findings[0]?.code, graph: e.graph, revision: e.revision })
              )
            );

        const refused = { code: "E-AUTHORITY", graph: null, revision: 0 };

        expect(yield* told(stranger, A)).toEqual(refused);
        expect(yield* told(worker, B)).toEqual(refused);
        expect(yield* told(worker)).toEqual(refused);

        expect(
          yield* code(graphs.logbook.read(stranger, { constellationId: CID, taskId: A }))
        ).toBe("E-AUTHORITY");
        // A's worker reads its own Task but not B, which A does not depend on.
        expect(yield* code(graphs.logbook.read(worker, { constellationId: CID, taskId: A }))).toBe(
          "allowed"
        );
        expect(yield* code(graphs.logbook.read(worker, { constellationId: CID, taskId: B }))).toBe(
          "E-AUTHORITY"
        );
        expect(yield* code(graphs.logbook.read(worker, { constellationId: CID }))).toBe(
          "E-AUTHORITY"
        );
        expect(yield* code(send(worker, note("Not my Task", B)))).toBe("E-AUTHORITY");
        expect(yield* code(send(stranger, note("Not my Constellation")))).toBe("E-AUTHORITY");

        const page = yield* graphs.logbook.read(user, { constellationId: CID });

        expect(kinds(page)).not.toContain("Note");
      })
    ));
});

describe("a Logbook's feed", () => {
  test("sends the read's page, then a page per change to the Task, and skips other Tasks' entries", () =>
    run(
      Effect.gen(function* () {
        const { graphs, store, send } = yield* working;
        const before = yield* store.subscriberCount;

        const fiber = yield* graphs.logbook
          .subscribe(user, { constellationId: CID, taskId: A })
          .pipe(Stream.take(3), Stream.runCollect, Effect.forkChild);

        while ((yield* store.subscriberCount) === before) yield* Effect.sleep(1);

        yield* send(user, note("B waits on the contract.", B));
        yield* send(worker, note("Claiming next."));
        yield* send(
          worker,
          C.WorkerClaim.make({
            constellationId: CID,
            attemptId: draft().id,
            claim: report("polaris/A", "head"),
          })
        );

        const pages = [...(yield* Fiber.join(fiber))];

        expect(pages.map(kinds)).toEqual([["Brief", "Progress"], ["Note"], ["Claim"]]);
        expect(pages.map((p) => p.attempts[0]?.state)).toEqual(["working", "working", "review"]);
        expect(pages[1]!.cursor).toBeGreaterThan(pages[0]!.cursor);
        expect(pages[2]!.cursor).toBeGreaterThan(pages[1]!.cursor);
      })
    ));

  test("from a cursor it starts with only the later entries", () =>
    run(
      Effect.gen(function* () {
        const { graphs, send } = yield* working;
        const read = yield* graphs.logbook.read(user, { constellationId: CID, taskId: A });

        yield* send(worker, note("After the cursor."));

        const [first] = yield* graphs.logbook
          .subscribe(user, { constellationId: CID, taskId: A, since: read.cursor })
          .pipe(Stream.take(1), Stream.runCollect);

        expect(first?.entries.map((e) => e.text)).toEqual(["After the cursor."]);
      })
    ));

  test("from a cursor ahead of the log it skips what is committed up to that cursor", () =>
    run(
      Effect.gen(function* () {
        const { graphs, store, send } = yield* working;
        const read = yield* graphs.logbook.read(user, { constellationId: CID, taskId: A });
        const before = yield* store.subscriberCount;

        const fiber = yield* graphs.logbook
          .subscribe(user, {
            constellationId: CID,
            taskId: A,
            since: Sequence.make(read.cursor + 1),
          })
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);

        while ((yield* store.subscriberCount) === before) yield* Effect.sleep(1);

        yield* send(worker, note("At the cursor."));
        yield* send(worker, note("After the cursor."));

        const pages = [...(yield* Fiber.join(fiber))];

        expect(pages.map((p) => p.entries.map((e) => e.text))).toEqual([[], ["After the cursor."]]);
      })
    ));

  test("a boundary change with no entry still sends a page", () =>
    run(
      Effect.gen(function* () {
        const { graphs, store, send } = yield* working;
        const before = yield* store.subscriberCount;

        const fiber = yield* graphs.logbook
          .subscribe(user, { constellationId: CID, taskId: A })
          .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);

        while ((yield* store.subscriberCount) === before) yield* Effect.sleep(1);

        yield* send(
          worker,
          C.WorkerBlock.make({
            constellationId: CID,
            attemptId: draft().id,
            on: [],
            reason: "Waiting for the Lead",
          })
        );

        const [, blocked] = yield* Fiber.join(fiber);

        expect([blocked?.entries.length, blocked?.attempts[0]?.state]).toEqual([0, "blocked"]);
      })
    ));

  test("ends refused once its reader's Attempt is no longer the Task's current one", () =>
    run(
      Effect.gen(function* () {
        const { graphs, store, send } = yield* working;
        const before = yield* store.subscriberCount;

        const fiber = yield* graphs.logbook
          .subscribe(worker, { constellationId: CID, taskId: A })
          .pipe(
            Stream.runCollect,
            Effect.as(null),
            Effect.catchTag("ConstellationRejected", (e) =>
              Effect.succeed({ code: e.findings[0]?.code, graph: e.graph })
            ),
            Effect.forkChild
          );

        while ((yield* store.subscriberCount) === before) yield* Effect.sleep(1);

        yield* send(
          user,
          C.Review.make({
            constellationId: CID,
            attemptId: draft().id,
            revision: 1,
            action: ReviewAction.cases.Stop.make({ reason: "Stopped." }),
          })
        );

        // Revoked with the finding alone: the graph it could read a moment ago is not sent.
        expect(yield* Fiber.join(fiber)).toEqual({ code: "E-AUTHORITY", graph: null });
      })
    ));
});

describe("the Constellation stream", () => {
  test("leaves a note out for a Client that didn't announce the Logbook, and sends it to one that did", () =>
    run(
      Effect.gen(function* () {
        const { graphs, store, send } = yield* working;

        const tags = (capabilities: ReadonlyArray<"constellation" | "constellation.logbook">) =>
          Effect.gen(function* () {
            const before = yield* store.subscriberCount;
            const model = yield* store.model;

            const fiber = yield* graphs
              .subscribe(user, CID, Sequence.make(model.sequence), capabilities)
              .pipe(
                Stream.filter((item) => Predicate.isTagged(item, "Event")),
                Stream.take(1),
                Stream.runCollect,
                Effect.forkChild
              );

            while ((yield* store.subscriberCount) === before) yield* Effect.sleep(1);

            yield* send(user, note("For the record."));
            yield* send(
              worker,
              C.WorkerProgress.make({
                constellationId: CID,
                attemptId: draft().id,
                note: "Next",
                completed: null,
                total: null,
                waiting: null,
              })
            );

            return [...(yield* Fiber.join(fiber))].map((item) =>
              Predicate.isTagged(item, "Event") ? item.envelope.event._tag : null
            );
          });

        expect(yield* tags(["constellation"])).toEqual(["AttemptProgressed"]);
        expect(yield* tags(["constellation", "constellation.logbook"])).toEqual(["LogbookNoted"]);
      })
    ));

  test("sends a worker the notes on its own Task and not those on a Task it may not read, live and on replay", () =>
    run(
      Effect.gen(function* () {
        const { graphs, store, send } = yield* working;
        const before = yield* store.subscriberCount;
        const cut = Sequence.make((yield* store.model).sequence);

        const fiber = yield* graphs
          .subscribe(worker, CID, cut, LOGBOOK)
          .pipe(Stream.filterMap(noteText), Stream.take(1), Stream.runCollect, Effect.forkChild);

        while ((yield* store.subscriberCount) === before) yield* Effect.sleep(1);

        yield* send(user, note("B waits on the contract.", B));
        yield* send(user, note("A is on the contract."));

        expect([...(yield* Fiber.join(fiber))]).toEqual(["A is on the contract."]);

        const replayed = yield* graphs.subscribe(worker, CID, cut, LOGBOOK).pipe(
          Stream.takeUntil((item) => Predicate.isTagged(item, "Synchronized")),
          Stream.filterMap(noteText),
          Stream.runCollect
        );

        expect([...replayed]).toEqual(["A is on the contract."]);
      })
    ));

  test("stops sending a worker its Task's notes once its Attempt is no longer active", () =>
    run(
      Effect.gen(function* () {
        const { graphs, store, send } = yield* working;
        const before = yield* store.subscriberCount;
        const cut = Sequence.make((yield* store.model).sequence);

        const fiber = yield* graphs.subscribe(worker, CID, cut, LOGBOOK).pipe(
          Stream.filterMap((item) =>
            Predicate.isTagged(item, "Event")
              ? Result.succeed(item.envelope.event._tag)
              : Result.failVoid
          ),
          Stream.takeUntil((tag) => tag === "TaskDeclared"),
          Stream.runCollect,
          Effect.forkChild
        );

        while ((yield* store.subscriberCount) === before) yield* Effect.sleep(1);

        yield* send(
          user,
          C.Review.make({
            constellationId: CID,
            attemptId: draft().id,
            revision: 1,
            action: ReviewAction.cases.Stop.make({ reason: "Stopped." }),
          })
        );
        yield* send(user, note("Stopped for the rebase."));
        yield* send(
          user,
          C.Plan.make({
            constellationId: CID,
            operations: [PlanOperation.cases.Add.make({ task: task(TaskId.make("X")) })],
          })
        );

        const tags = [...(yield* Fiber.join(fiber))];

        // The feed is still open and carries the settle, but not the note.
        expect(tags).toContain("AttemptSettled");
        expect(tags).not.toContain("LogbookNoted");
      })
    ));
});
