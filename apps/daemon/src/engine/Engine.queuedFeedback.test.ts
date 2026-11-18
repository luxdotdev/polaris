/**
 * A `SendFeedback` that waits behind a paused queue (ENG-941): the Turn it starts as after
 * Resume still carries its batch and Comments, so they read as sent with it.
 */
import { expect, test } from "bun:test";
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
  Share,
  ShareId,
  SharePerson,
  ShareTarget,
} from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { ShareBook } from "../shares/identities.ts";
import { commentsOf } from "../store/comments.ts";
import { EventStore } from "../store/EventStore.ts";
import { queueOf } from "../store/queuedTurns.ts";
import { Engine } from "./Engine.ts";
import { PairingBook } from "./queueAccess.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "./testing.ts";

const S = SessionId.make("s-feedback-queue");

const OWNER = Actor.cases.Client.make({});

const ana = Actor.cases.Teammate.make({
  shareId: ShareId.make("share-Ana"),
  personId: PersonId.make("person-Ana"),
  name: "Ana",
});

const anaShare = new Share({
  id: ShareId.make("share-Ana"),
  target: ShareTarget.cases.Session.make({ sessionId: S }),
  issuer: "https://accounts.example",
  person: new SharePerson({
    id: PersonId.make("person-Ana"),
    login: "ana",
    name: "Ana",
    avatarUrl: null,
    commitEmail: null,
  }),
  role: "contributor",
  grant: ["read", "comment", "approve", "turn"],
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2999-01-01T00:00:00.000Z",
  revokedAt: null,
});

const COMMENT = CommentId.make("c-ana");

test("a SendFeedback queued behind a paused queue starts with its batch, and its Comments read as sent with it", async () => {
  const driver = makeFakeDriver("claude", {
    onInterrupt: (session) => [
      HarnessEvent.TurnEnded({
        turnId: session.turns.at(-1)!.turnId,
        status: "interrupted",
        error: null,
      }),
    ],
  });

  const layer = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
  }).pipe(
    Layer.provide(Layer.succeed(ShareBook)({ all: Effect.succeed([anaShare]), bind: () => {} })),
    Layer.provide(Layer.succeed(PairingBook)({ all: Effect.succeed(null), bind: () => {} }))
  );

  const dispatch = (command: Command, actor: Actor = OWNER) =>
    Effect.flatMap(Engine, (engine) =>
      engine.dispatch({ commandId: cid("fb"), command, deviceLabel: "MacBook", actor })
    );

  const record = Effect.map(
    Effect.flatMap(EventStore, (store) => store.model),
    (model) => model.sessions.get(S)!
  );

  const batch = new FeedbackBatch({ message: "Tighten the parser", comments: [] });

  await Effect.runPromise(
    Effect.gen(function* () {
      const repo = fakeRepo();
      yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
      const model = yield* waitFor((m) => m.workspaces.size > 0);
      yield* dispatch(
        Command.cases.StartSession.make({
          sessionId: S,
          workspaceId: [...model.workspaces.keys()][0]!,
          harness: "claude",
          placement: SessionPlacement.cases.InPlace.make({}),
          permissionMode: "supervised",
          model: null,
          effort: null,
          prompt: "first",
          attachments: [],
        })
      );
      yield* waitUntil(() => driver.latest(S)?.turns.length === 1);
      const first = (yield* record).turns[0]!;

      // Ana's Turn waits; the Interrupt pauses the queue behind it.
      yield* dispatch(
        Command.cases.SendTurn.make({ sessionId: S, prompt: "from Ana", attachments: [] }),
        ana
      );
      yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }), ana);
      yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");

      yield* dispatch(
        Command.cases.AddComment.make({
          sessionId: S,
          commentId: COMMENT,
          anchor: CommentAnchor.cases.DiffLines.make({
            turnId: first.id,
            path: "src/parse.ts",
            side: "new",
            start: 1,
            end: 1,
            code: "const x = 1;",
          }),
          body: "This drops the last token",
        }),
        ana
      );
      yield* dispatch(
        Command.cases.SendFeedback.make({
          sessionId: S,
          feedback: batch,
          attachments: [],
          commentIds: [COMMENT],
        })
      );

      const queued = queueOf(yield* record);
      expect(queued.map((q) => q.actor)).toEqual([ana, OWNER]);
      yield* dispatch(
        Command.cases.CancelQueuedTurn.make({ sessionId: S, turnId: queued[0]!.id }),
        ana
      );
      yield* dispatch(Command.cases.ResumeQueue.make({ sessionId: S }));
      yield* waitUntil(() => driver.latest(S)?.turns.length === 2);

      const after = yield* record;
      const started = after.turns.at(-1)!;

      expect(started).toMatchObject({
        id: queued[1]!.id,
        actor: OWNER,
        feedback: batch,
        commentIds: [COMMENT],
      });
      expect(commentsOf(after).get(COMMENT)).toMatchObject({
        author: ana,
        sentInTurnId: started.id,
      });

      // Sent, it is no longer Ana's to edit.
      const edit = yield* Effect.flip(
        dispatch(
          Command.cases.EditComment.make({ sessionId: S, commentId: COMMENT, body: "later" }),
          ana
        )
      );

      expect(edit._tag).toBe("CommandRejected");
    }).pipe(Effect.provide(layer))
  );
});
