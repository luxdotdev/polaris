/** Who did it (ENG-398): the decider stamps the actor on session starts, Turns and approvals. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Actor,
  ApprovalDecision,
  Command,
  PairingId,
  PersonId,
  RequestId,
  SessionId,
  SessionPlacement,
  ShareId,
} from "@polaris/protocol";
import { Effect, type Layer, Predicate } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
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

const raycast = Actor.cases.Extension.make({
  pairingId: PairingId.make("pair_1"),
  name: "Raycast",
});

const octocat = Actor.cases.Teammate.make({
  shareId: ShareId.make("share_1"),
  personId: PersonId.make("p1"),
  name: "The Octocat",
});

/** A Client's command from the MacBook, or an Extension's. */
const dispatch = (command: Command, actor?: Actor) =>
  Effect.flatMap(Engine, (engine) =>
    actor === undefined
      ? engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
      : engine.dispatch({ commandId: cid(), command, deviceLabel: "Raycast", actor })
  );

describe("actors", () => {
  test("an Extension's start, Turn and approval say so; a Client's say Client", async () => {
    const codex = makeFakeDriver("codex");

    const layer = engineLayer({
      filename: join(tempDir(), "state.sqlite"),
      fakes: makeFakes(),
      drivers: [codex],
    });

    const s = SessionId.make("s-actor");

    await run(
      layer,
      Effect.gen(function* () {
        const store = yield* EventStore;
        const repo = fakeRepo();
        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));

        const registered = yield* waitFor((m) =>
          [...m.workspaces.values()].some((w) => w.path === repo)
        );

        const workspace = [...registered.workspaces.values()].find((w) => w.path === repo)!;

        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId: s,
            workspaceId: workspace.id,
            harness: "codex",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "Summarize the diff",
            attachments: [],
          }),
          raycast
        );
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        const harness = codex.latest(s)!;
        const requestId = RequestId.make("req-actor");
        harness.emit(
          HarnessEvent.ApprovalRequested({
            turnId: harness.turns[0]!.turnId,
            requestId,
            kind: "command",
            title: "Run bun test",
            detail: null,
            options: [],
          })
        );
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "needs-you");
        yield* dispatch(
          Command.cases.RespondToApproval.make({
            sessionId: s,
            requestId,
            decision: ApprovalDecision.cases.Allow.make({ remember: false }),
          })
        );
        const model = yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: s });

        const created = events.find((e) => Predicate.isTagged(e.event, "SessionCreated"))!.event;
        const started = events.find((e) => Predicate.isTagged(e.event, "TurnStarted"))!.event;
        const resolved = events.find((e) => Predicate.isTagged(e.event, "ApprovalResolved"))!.event;
        expect(created).toMatchObject({ actor: raycast });
        expect(started).toMatchObject({ actor: raycast });
        expect(resolved).toMatchObject({
          actor: Actor.cases.Client.make({}),
          resolvedBy: "MacBook",
        });
      })
    );
  });

  test("a Teammate's answer wins and names them; the owner's late answer and a remembered allow are refused", async () => {
    const codex = makeFakeDriver("codex");

    const layer = engineLayer({
      filename: join(tempDir(), "state.sqlite"),
      fakes: makeFakes(),
      drivers: [codex],
    });

    const s = SessionId.make("s-teammate");

    await run(
      layer,
      Effect.gen(function* () {
        const store = yield* EventStore;
        const repo = fakeRepo();
        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));

        const registered = yield* waitFor((m) =>
          [...m.workspaces.values()].some((w) => w.path === repo)
        );

        const workspace = [...registered.workspaces.values()].find((w) => w.path === repo)!;

        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId: s,
            workspaceId: workspace.id,
            harness: "codex",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "Fix the build",
            attachments: [],
          })
        );
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        const harness = codex.latest(s)!;
        const requestId = RequestId.make("req-teammate");
        harness.emit(
          HarnessEvent.ApprovalRequested({
            turnId: harness.turns[0]!.turnId,
            requestId,
            kind: "command",
            title: "Run bun test",
            detail: null,
            options: [],
          })
        );
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "needs-you");

        // The refusal's reason, or null when the answer was recorded.
        const answer = (decision: ApprovalDecision, actor?: Actor) =>
          dispatch(
            Command.cases.RespondToApproval.make({ sessionId: s, requestId, decision }),
            actor
          ).pipe(
            Effect.as(null),
            Effect.catchTag("CommandRejected", (rejected) => Effect.succeed(rejected.reason))
          );

        // Always allowing reaches past this request: that stays the owner's.
        const remembered = yield* answer(
          ApprovalDecision.cases.Allow.make({ remember: true }),
          octocat
        );

        expect(remembered).toContain("a Teammate allows this request only");

        // An agent's option named in text could be its always-allow: a Teammate can't pick one.
        const named = yield* answer(
          ApprovalDecision.cases.Answer.make({ text: "Always allow" }),
          octocat
        );

        expect(named).toContain("an allow once or a deny");
        expect(
          yield* answer(ApprovalDecision.cases.Allow.make({ remember: false }), octocat)
        ).toBeNull();

        // First answer wins: the owner's, sent after, is refused rather than recorded.
        const late = yield* answer(ApprovalDecision.cases.Deny.make({ reason: null }));
        expect(late).toContain("already resolved");

        const model = yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: s });
        const resolved = events.filter((e) => Predicate.isTagged(e.event, "ApprovalResolved"));

        expect(resolved).toHaveLength(1);
        expect(resolved[0]?.event).toMatchObject({
          actor: octocat,
          resolvedBy: "The Octocat",
          decision: ApprovalDecision.cases.Allow.make({ remember: false }),
        });
      })
    );
  });
});
