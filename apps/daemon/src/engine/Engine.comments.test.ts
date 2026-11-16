import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Actor,
  Command,
  CommentAnchor,
  CommentId,
  FeedbackBatch,
  PersonId,
  SessionId,
  SessionPlacement,
  ShareId,
  type ShareRole,
  TurnId,
  type Workspace,
} from "@polaris/protocol";
import { Effect, Layer, Predicate, Stream } from "effect";
import type { LineSpan } from "../git/changedLines.ts";
import { Checkpoints } from "../services.ts";
import { commentsOf } from "../store/comments.ts";
import { EventStore } from "../store/EventStore.ts";
import { actorSessionItemsFor } from "./actorCompat.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

type Env = Engine | EventStore;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const OWNER = Actor.cases.Client.make({});

const teammate = (name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${name}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const ana = teammate("Ana");

const bob = teammate("Bob");

const dispatch = (command: Command, actor: Actor = OWNER, shareRole: ShareRole | null = null) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook", actor, shareRole })
  );

const rejection = (command: Command, actor: Actor = OWNER, shareRole: ShareRole | null = null) =>
  Effect.flip(dispatch(command, actor, shareRole)).pipe(
    Effect.map((error) =>
      Predicate.isTagged(error, "CommandRejected") ? error.reason : error._tag
    )
  );

const sessionId = SessionId.make("s-comments");

const registerWorkspace = Effect.gen(function* () {
  const repo = fakeRepo();
  yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));

  const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));

  return [...model.workspaces.values()].find((w) => w.path === repo)!;
});

/** A session whose first Turn completed; returns that Turn's id. */
const idleSession = (workspace: Workspace) =>
  Effect.gen(function* () {
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "Add the parser",
        attachments: [],
      })
    );

    const model = yield* waitFor(
      (m) =>
        m.sessions.get(sessionId)?.session.state === "idle" &&
        m.sessions.get(sessionId)?.turns[0]?.checkpointAfter != null
    );

    return model.sessions.get(sessionId)!.turns[0]!.id;
  });

const lines = (turnId: TurnId, start: number, end: number, side: "new" | "old" = "new") =>
  CommentAnchor.cases.DiffLines.make({
    turnId,
    path: "src/parse.ts",
    side,
    start,
    end,
    code: "const x = 1;",
  });

const add = (id: string, anchor: CommentAnchor, body: string, actor: Actor = OWNER) =>
  dispatch(
    Command.cases.AddComment.make({ sessionId, commentId: CommentId.make(id), anchor, body }),
    actor
  );

const comments = Effect.map(
  Effect.flatMap(EventStore, (store) => store.model),
  (model) => commentsOf(model.sessions.get(sessionId)!)
);

const feedback = (ids: ReadonlyArray<string>, message: string | null = null) =>
  Command.cases.SendFeedback.make({
    sessionId,
    feedback: new FeedbackBatch({ message, comments: [] }),
    attachments: [],
    commentIds: ids.map((id) => CommentId.make(id)),
  });

/** `changedLines` answers the outdating follower; by default nothing changed. */
const setup = (
  changedLines: (path: string, from: string, to: string) => ReadonlyArray<LineSpan> = () => []
) =>
  engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [makeFakeDriver("claude", { onTurn: completesTurns("c-1") })],
    checkpoints: Layer.succeed(Checkpoints)({
      capture: ({ sessionId: sid, turnId, label }) =>
        Effect.sync(() => ({
          ref: `refs/polaris/checkpoints/${sid}/${turnId}/${label}`,
          commit: `commit-${turnId}-${label}`,
        })),
      changedLines: ({ path, from, to }) => Effect.sync(() => changedLines(path, from, to)),
    }),
  });

describe("Comments (ADR 0113)", () => {
  test("Comments replay after a restart with their authors, edits and resolution", async () => {
    const layer = setup();

    await run(
      layer,
      Effect.gen(function* () {
        const turnId = yield* idleSession(yield* registerWorkspace);
        yield* add("c-ana", lines(turnId, 3, 5), "Rename this", ana);
        yield* add("c-owner", lines(turnId, 10, 10), "Why a loop?");
        yield* dispatch(
          Command.cases.EditComment.make({
            sessionId,
            commentId: CommentId.make("c-ana"),
            body: "Rename this to parseLine",
          }),
          ana
        );
        yield* dispatch(
          Command.cases.ResolveComment.make({ sessionId, commentId: CommentId.make("c-owner") })
        );
      })
    );

    // A second run over the same database is a Daemon restart: the model loads from SQL.
    const replayed = await run(
      layer,
      Effect.gen(function* () {
        const loaded = yield* comments;
        const engine = yield* Engine;

        const snapshot = yield* engine
          .subscribeSession({
            sessionId,
            afterSequence: null,
            turnLimit: null,
            capabilities: ["session.comments", "actor.teammate", "actor.linked-device"],
          })
          .pipe(Stream.take(1), Stream.runCollect);

        return { loaded, snapshot: snapshot[0] };
      })
    );

    const anas = replayed.loaded.get(CommentId.make("c-ana"))!;
    expect(anas.author).toEqual(ana);
    expect(anas.body).toBe("Rename this to parseLine");
    expect(anas.editedAt).not.toBeNull();
    const owners = replayed.loaded.get(CommentId.make("c-owner"))!;
    expect(owners.author).toEqual(OWNER);
    expect(owners.resolvedBy).toEqual(OWNER);
    expect([...replayed.loaded.keys()]).toEqual([
      CommentId.make("c-ana"),
      CommentId.make("c-owner"),
    ]);

    if (replayed.snapshot === undefined || !Predicate.isTagged(replayed.snapshot, "Snapshot"))
      throw new Error("expected a snapshot");
    expect(replayed.snapshot.comments?.map((c) => [c.id, c.author])).toEqual([
      [CommentId.make("c-ana"), ana],
      [CommentId.make("c-owner"), OWNER],
    ]);
  });

  test("a Client without actor.teammate reads a Teammate's Comment as a Client's; one without session.comments gets none", async () => {
    const layer = setup();

    const [old, none] = await run(
      layer,
      Effect.gen(function* () {
        const turnId = yield* idleSession(yield* registerWorkspace);
        yield* add("c-ana", lines(turnId, 3, 5), "Rename this", ana);
        const engine = yield* Engine;

        const first = (capabilities: ReadonlyArray<"session.comments">) =>
          engine
            .subscribeSession({ sessionId, afterSequence: null, turnLimit: null, capabilities })
            .pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.map((items) => items[0])
            );

        return [yield* first(["session.comments"]), yield* first([])] as const;
      })
    );

    // The compat rewrite runs in the RPC handler (`rpc.ts`), not the Engine's stream.
    const rewrite = actorSessionItemsFor(["session.comments"]);

    if (rewrite === null || old === undefined) throw new Error("expected a rewrite and a snapshot");
    const rewritten = rewrite(old);

    if (!Predicate.isTagged(rewritten, "Snapshot") || !Predicate.isTagged(none, "Snapshot"))
      throw new Error("expected snapshots");
    expect(rewritten.comments?.[0]?.author).toEqual(OWNER);
    expect(none.comments ?? []).toEqual([]);
  });

  test("SendFeedback with another's Comments: the Turn's Actor is the sender, each Comment keeps its author", async () => {
    const layer = setup();

    const result = await run(
      layer,
      Effect.gen(function* () {
        const turnId = yield* idleSession(yield* registerWorkspace);
        yield* add("c-ana", lines(turnId, 3, 5), "Rename this", ana);
        yield* add("c-owner", lines(turnId, 10, 10), "Why a loop?");
        yield* dispatch(feedback(["c-ana", "c-owner"], "Two notes"), bob, "contributor");

        const model = yield* waitFor((m) => m.sessions.get(sessionId)?.session.turnCount === 2);
        const store = yield* EventStore;

        const events = yield* store
          .readEvents({ after: 0, upTo: model.sequence, sessionId, eventTypes: ["TurnStarted"] })
          .pipe(Effect.orDie);

        const resend = yield* rejection(feedback(["c-ana"]), bob, "contributor");

        return { model, events, resend };
      })
    );

    const record = result.model.sessions.get(sessionId)!;
    const turn = record.turns[1]!;

    const started = result.events.flatMap((e) =>
      Predicate.isTagged(e.event, "TurnStarted") && e.event.turn.id === turn.id ? [e.event] : []
    );

    expect(started[0]?.actor).toEqual(bob);
    expect(turn.commentIds).toEqual([CommentId.make("c-ana"), CommentId.make("c-owner")]);
    expect(turn.prompt).toContain("Two notes");
    expect(turn.prompt).toContain("src/parse.ts:3-5 (comment by Ana)");
    expect(turn.prompt).toContain("src/parse.ts:10 (comment by the owner)");
    expect(turn.prompt.indexOf("Rename this")).toBeLessThan(turn.prompt.indexOf("Why a loop?"));

    const kept = commentsOf(record);
    expect(kept.get(CommentId.make("c-ana"))?.author).toEqual(ana);
    expect(kept.get(CommentId.make("c-owner"))?.author).toEqual(OWNER);
    expect(kept.get(CommentId.make("c-ana"))?.sentInTurnId).toBe(turn.id);
    expect(result.resend).toBe(`Comment c-ana was already sent with Turn ${turn.id}`);

    // The sent marks replay too.
    const replayed = await run(layer, comments);
    expect(replayed.get(CommentId.make("c-owner"))?.sentInTurnId).toBe(turn.id);
  });

  test("who may edit, resolve and send", async () => {
    const layer = setup();

    const reasons = await run(
      layer,
      Effect.gen(function* () {
        const turnId = yield* idleSession(yield* registerWorkspace);
        yield* add("c-ana", lines(turnId, 3, 5), "Rename this", ana);
        const id = CommentId.make("c-ana");
        const edit = Command.cases.EditComment.make({ sessionId, commentId: id, body: "x" });
        const resolve = Command.cases.ResolveComment.make({ sessionId, commentId: id });

        const editByOwner = yield* rejection(edit);
        const resolveByCommenter = yield* rejection(resolve, bob, "commenter");
        yield* dispatch(resolve, bob, "contributor");
        const resolveAgain = yield* rejection(resolve, ana, "commenter");
        const unknown = yield* rejection(feedback(["c-none"]));

        const badTurn = yield* rejection(
          Command.cases.AddComment.make({
            sessionId,
            commentId: CommentId.make("c-2"),
            anchor: lines(TurnId.make("turn-elsewhere"), 1, 1),
            body: "Hm",
          })
        );

        yield* dispatch(feedback(["c-ana"]));
        const editSent = yield* rejection(edit, ana, "commenter");

        return { editByOwner, resolveByCommenter, resolveAgain, unknown, badTurn, editSent };
      })
    );

    expect(reasons).toEqual({
      editByOwner: "only its author edits a Comment",
      resolveByCommenter:
        "only its author, the session's owner or a Contributor resolves a Comment",
      resolveAgain: "the Comment is already resolved",
      unknown: "there is no Comment c-none",
      badTurn: "Turn turn-elsewhere is not one of this session's",
      editSent: "the Comment was already sent",
    });
  });

  test("a later Turn that changes a Comment's lines marks it outdated, and moves nothing", async () => {
    const asked: Array<{ path: string; from: string; to: string }> = [];

    const layer = setup((path, from, to) => {
      asked.push({ path, from, to });

      return [{ start: 4, count: 1 }];
    });

    const result = await run(
      layer,
      Effect.gen(function* () {
        const first = yield* idleSession(yield* registerWorkspace);
        yield* add("c-hit", lines(first, 3, 5), "Rename this");
        yield* add("c-miss", lines(first, 20, 22), "Fine");
        yield* add("c-removed", lines(first, 3, 5, "old"), "Good riddance");
        yield* dispatch(
          Command.cases.SendTurn.make({ sessionId, prompt: "Go on", attachments: [] })
        );

        const model = yield* waitFor(
          (m) =>
            commentsOf(m.sessions.get(sessionId)!).get(CommentId.make("c-hit"))?.outdatedInTurnId !=
            null
        );

        return { first, second: model.sessions.get(sessionId)!.turns[1]!.id, model };
      })
    );

    const kept = commentsOf(result.model.sessions.get(sessionId)!);
    expect(kept.get(CommentId.make("c-hit"))?.outdatedInTurnId).toBe(result.second);
    expect(kept.get(CommentId.make("c-hit"))?.anchor).toEqual(lines(result.first, 3, 5));
    expect(kept.get(CommentId.make("c-miss"))?.outdatedInTurnId).toBeNull();
    expect(kept.get(CommentId.make("c-removed"))?.outdatedInTurnId).toBeNull();
    expect(asked).toContainEqual({
      path: "src/parse.ts",
      from: `refs/polaris/checkpoints/${sessionId}/${result.first}/after`,
      to: `refs/polaris/checkpoints/${sessionId}/${result.second}/after`,
    });

    const replayed = await run(layer, comments);
    expect(replayed.get(CommentId.make("c-hit"))?.outdatedInTurnId).toBe(result.second);
  });
});
