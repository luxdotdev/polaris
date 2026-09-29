import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSession,
  CommandId,
  CommandRejected,
  DomainEvent,
  Sequence,
  SessionId,
  Turn,
  TurnId,
  TurnItem,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect, Exit, Fiber, Predicate, Stream } from "effect";
import { CommitResult, EventStore } from "./EventStore.ts";

const run = <A, E>(filename: string, program: Effect.Effect<A, E, EventStore>) =>
  Effect.runPromise(program.pipe(Effect.provide(EventStore.layerSqlite(filename))));

const at = "2026-09-28T00:00:00.000Z";

const wsId = WorkspaceId.make("ws-1");

const sId = SessionId.make("s-1");

const tId = TurnId.make("t-1");

const workspace = new Workspace({
  id: wsId,
  path: "/repo",
  name: "repo",
  isGitRepo: true,
  worktreeRoot: "/repo.worktrees",
  hidden: false,
  registeredAt: at,
});

/** `workspace` under another name. */
const workspaceNamed = (name: string) =>
  new Workspace({
    id: workspace.id,
    path: workspace.path,
    name,
    isGitRepo: workspace.isGitRepo,
    worktreeRoot: workspace.worktreeRoot,
    hidden: workspace.hidden,
    registeredAt: workspace.registeredAt,
  });

const session = new AgentSession({
  id: sId,
  workspaceId: wsId,
  harness: "claude",
  title: "t",
  cwd: "/repo",
  worktreeId: null,
  state: "starting",
  permissionMode: "supervised",
  model: null,
  effort: null,
  parentSessionId: null,
  forkedFromTurnId: null,
  harnessCursor: null,
  turnCount: 0,
  lastError: null,
  createdAt: at,
  updatedAt: at,
});

const turn = new Turn({
  id: tId,
  sessionId: sId,
  index: 0,
  prompt: "hi",
  attachments: [],
  model: null,
  effort: null,
  status: "working",
  checkpointBefore: null,
  checkpointAfter: null,
  startedAt: at,
  endedAt: null,
});

const seed = (store: EventStore["Service"]) =>
  store.commit({
    commandId: CommandId.make("seed"),
    decide: () =>
      Effect.succeed([
        DomainEvent.cases.WorkspaceRegistered.make({ workspace }),
        DomainEvent.cases.SessionCreated.make({ session }),
        DomainEvent.cases.TurnStarted.make({ turn }),
        DomainEvent.cases.TurnItemCompleted.make({
          sessionId: sId,
          turnId: tId,
          item: TurnItem.cases.AssistantMessage.make({ id: "m1", text: "hello" }),
        }),
        DomainEvent.cases.SessionRenamed.make({ sessionId: sId, title: "Renamed" }),
      ]),
  });

describe("EventStore", () => {
  test("events, projections and receipt commit together and reload from disk", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "polaris-store-")), "state.sqlite");
    await run(
      file,
      Effect.gen(function* () {
        const store = yield* EventStore;
        const result = yield* seed(store);
        expect(result._tag).toBe("Committed");
        expect(result).toMatchObject({ sequence: 5 });
        const again = yield* seed(store);
        expect(again).toEqual(CommitResult.Duplicate({ sequence: Sequence.make(5) }));
      })
    );
    await run(
      file,
      Effect.gen(function* () {
        const store = yield* EventStore;
        const model = yield* store.model;
        expect(model.sequence).toBe(5);
        expect(model.workspaces.get(wsId)).toEqual(workspace);
        const record = model.sessions.get(sId)!;
        expect(record.session.title).toBe("Renamed");
        // The seed carried a command id, so the rename counts as the user's.
        expect(record.titleLocked).toBe(true);
        expect(record.turns).toEqual([turn]);
        const items = yield* store.readTurnItems({ turnIds: [tId], upTo: 5 });
        expect(items.get(tId)).toEqual([
          TurnItem.cases.AssistantMessage.make({ id: "m1", text: "hello" }),
        ]);
      })
    );
  });

  test("the Host stream replay leaves out per-item events", async () => {
    await run(
      ":memory:",
      Effect.gen(function* () {
        const store = yield* EventStore;
        yield* seed(store);
        const host = yield* store.readEvents({ after: 0, upTo: 5, sessionId: null });
        expect(host.map((e) => e.event._tag)).toEqual([
          "WorkspaceRegistered",
          "SessionCreated",
          "TurnStarted",
          "SessionRenamed",
        ]);
        const sessionEvents = yield* store.readEvents({ after: 1, upTo: 5, sessionId: sId });
        expect(sessionEvents.map((e) => Number(e.sequence))).toEqual([2, 3, 4, 5]);
      })
    );
  });

  test("concurrent commits get a gapless sequence", async () => {
    await run(
      ":memory:",
      Effect.gen(function* () {
        const store = yield* EventStore;
        yield* seed(store);
        yield* Effect.forEach(
          Array.from({ length: 50 }, (_, i) => i),
          (i) =>
            store.commit({
              commandId: null,
              decide: () =>
                Effect.succeed([
                  DomainEvent.cases.SessionRenamed.make({ sessionId: sId, title: `t${i}` }),
                  DomainEvent.cases.SessionStateChanged.make({
                    sessionId: sId,
                    state: "working",
                    reason: null,
                  }),
                ]),
            }),
          { concurrency: "unbounded" }
        );
        const all = yield* store.readEvents({ after: 0, upTo: 1000, sessionId: sId });
        const sequences = all.map((e) => Number(e.sequence));
        expect(sequences).toEqual(Array.from({ length: 104 }, (_, i) => i + 2));
      })
    );
  });

  test("commits queued together are decided in order and settled one by one", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "polaris-store-")), "state.sqlite");
    await run(
      file,
      Effect.gen(function* () {
        const store = yield* EventStore;
        yield* seed(store);

        const rename = (title: string) =>
          Effect.succeed([DomainEvent.cases.SessionRenamed.make({ sessionId: sId, title })]);

        const again = CommandId.make("c-again");
        const rejected = CommandId.make("c-rejected");
        const rejection = new CommandRejected({ commandId: rejected, reason: "no" });
        const seen: Array<number> = [];

        // Forked together, these all queue before the writer runs: one batch.
        const results = yield* Effect.all(
          [
            store.commit({
              commandId: again,
              decide: (model) => {
                seen.push(model.sequence);

                return rename("first");
              },
            }),
            store.commit({ commandId: again, decide: () => rename("never") }),
            Effect.flip(
              store.commit({ commandId: rejected, decide: () => Effect.fail(rejection) })
            ),
            Effect.flip(
              store.commit<CommandRejected>({ commandId: rejected, decide: () => rename("never") })
            ),
            Effect.exit(store.commit({ commandId: null, decide: () => Effect.die("boom") })),
            store.commit({
              commandId: null,
              decide: (model) => {
                seen.push(model.sequence);

                return rename("last");
              },
            }),
          ],
          { concurrency: "unbounded" }
        );

        const [first, duplicate, rejectedOnce, rejectedAgain, died, last] = results;
        expect(first._tag).toBe("Committed");
        expect(first).toMatchObject({ sequence: 6 });
        expect(duplicate).toEqual(CommitResult.Duplicate({ sequence: Sequence.make(6) }));
        expect(rejectedOnce).toEqual(rejection);
        expect(rejectedAgain).toEqual(rejection);
        expect(Exit.isFailure(died)).toBe(true);
        expect(last._tag).toBe("Committed");
        expect(last).toMatchObject({ sequence: 7 });
        // Each decide saw the model the commands before it in the batch produced.
        expect(seen).toEqual([5, 6]);
        const model = yield* store.model;
        expect(model.sequence).toBe(7);
        expect(model.sessions.get(sId)!.session.title).toBe("last");
      })
    );
    // Everything, receipts included, reached the disk.
    await run(
      file,
      Effect.gen(function* () {
        const store = yield* EventStore;
        expect((yield* store.model).sequence).toBe(7);
        const rejected = CommandId.make("c-rejected");

        const replay = yield* Effect.flip(
          store.commit<CommandRejected>({ commandId: rejected, decide: () => Effect.succeed([]) })
        );

        expect(replay).toEqual(new CommandRejected({ commandId: rejected, reason: "no" }));
      })
    );
  });

  test("subscribers hear of a batch only once it is committed", async () => {
    await run(
      ":memory:",
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* EventStore;
          const live = yield* store.subscribe();

          const checked = yield* live.pipe(
            Stream.take(30),
            Stream.mapEffect((item) =>
              Effect.gen(function* () {
                if (!Predicate.isTagged(item, "Event")) return false;
                const sequence = item.envelope.sequence;
                const model = yield* store.model;

                const rows = yield* store.readEvents({
                  after: sequence - 1,
                  upTo: sequence,
                  sessionId: null,
                });

                return model.sequence >= sequence && rows.length === 1;
              })
            ),
            Stream.runCollect,
            Effect.forkChild
          );

          yield* Effect.forEach(
            Array.from({ length: 30 }, (_, i) => i),
            (i) =>
              store.commit({
                commandId: null,
                decide: () =>
                  Effect.succeed([
                    DomainEvent.cases.WorkspaceUpdated.make({
                      workspace: workspaceNamed(`w${i}`),
                    }),
                  ]),
              }),
            { concurrency: "unbounded", discard: true }
          );
          const results = yield* Fiber.join(checked);
          expect([...results]).toEqual(Array.from({ length: 30 }, () => true));
        })
      )
    );
  });

  test("a rejected command's receipt replays the rejection", async () => {
    await run(
      ":memory:",
      Effect.gen(function* () {
        const store = yield* EventStore;
        const commandId = CommandId.make("c-reject");
        const rejection = new CommandRejected({ commandId, reason: "no" });

        const first = yield* Effect.flip(
          store.commit({ commandId, decide: () => Effect.fail(rejection) })
        );

        const second = yield* Effect.flip(
          store.commit<CommandRejected>({ commandId, decide: () => Effect.succeed([]) })
        );

        expect(first).toEqual(rejection);
        expect(second).toEqual(rejection);
        expect((yield* store.model).sequence).toBe(0);
      })
    );
  });
});
