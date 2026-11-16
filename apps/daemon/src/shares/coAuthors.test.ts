/**
 * Co-author trailers from a real Share (ENG-941): the Share service's own store, filled in by
 * the issuer's statement, is where a Teammate's name and commit email come from.
 */
import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  Actor,
  Command,
  InviteId,
  PersonId,
  SessionId,
  SessionPlacement,
  ShareTarget,
} from "@polaris/protocol";
import { Effect, Layer, Predicate, Redacted } from "effect";
import { sessionTrailers } from "../coAuthors/index.ts";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  tempDir as engineDir,
  waitFor,
} from "../engine/testing.ts";
import { makeRepo, removeTempDir } from "../git/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { tempDir } from "../platform/tempDir.testing.ts";
import { HostSecrets } from "../secrets/index.ts";
import { EventStore } from "../store/EventStore.ts";
import { TeammateConnections } from "./connection.ts";
import { CommitIdentitiesLive } from "./identities.ts";
import { type FakeIssuer, startFakeIssuer } from "./issuer.testing.ts";
import { Shares, teammateActor } from "./service.ts";
import { ShareStore } from "./store.ts";
import { ShareTargetsLive } from "./targets.ts";

const cleanup: Array<() => void> = [];

afterEach(() => {
  cleanup.splice(0).forEach((undo) => undo());
});

const sessionId = SessionId.make("s-shared");

const PERSON = PersonId.make("p1");

const INVITE = InviteId.make("inv_1");

const TRAILER = "Co-authored-by: The Octocat <octocat@github.test>";

/** The Daemon's own wiring: the Engine reads identities the Share service binds. */
const host = (server: FakeIssuer, claude: ReturnType<typeof makeFakeDriver>) => {
  const engine = engineLayer({
    filename: join(engineDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [claude],
  }).pipe(Layer.provideMerge(CommitIdentitiesLive));

  const shares = Shares.layer({
    fetch: server.fetch,
    timing: { waitS: 2, pauseMs: 5, retryMs: 20 },
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        ShareStore.layer(join(tempDir("pl-shares-"), "shares.sqlite")),
        HostSecrets.memory(),
        Layer.succeed(TeammateConnections)({ serve: () => Effect.void })
      )
    )
  );

  return ShareTargetsLive.pipe(Layer.provideMerge(Layer.merge(engine, shares)));
};

const dispatch = (command: Command, actor: Actor = Actor.cases.Client.make({})) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({
      commandId: cid(),
      command,
      deviceLabel: "MacBook",
      actor,
      shareRole: Predicate.isTagged(actor, "Teammate") ? "contributor" : null,
    })
  );

const turnDone = (index: number) =>
  waitFor((model) => model.sessions.get(sessionId)?.turns[index]?.status === "completed", 5000);

test("a Teammate's Turn through a real Share is credited with the name and commit email its statement gave", async () => {
  const server = await startFakeIssuer();
  const repo = await makeRepo();

  const claude = makeFakeDriver("claude", {
    onTurn: (input) => [
      HarnessEvent.TurnStarted({ turnId: input.turnId, prompt: input.prompt }),
      HarnessEvent.TurnEnded({ turnId: input.turnId, status: "completed", error: null }),
    ],
  });

  cleanup.push(
    () => server.stop(),
    () => removeTempDir(repo)
  );
  server.invite(INVITE, "cap");

  await Effect.runPromise(
    Effect.gen(function* () {
      const shares = yield* Shares;
      const store = yield* EventStore;

      yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
      const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
      const workspace = [...model.workspaces.values()].find((w) => w.path === repo);

      if (workspace === undefined) throw new Error("expected the workspace");

      yield* dispatch(
        Command.cases.StartSession.make({
          sessionId,
          workspaceId: workspace.id,
          harness: "claude",
          placement: SessionPlacement.cases.InPlace.make({}),
          permissionMode: "supervised",
          model: null,
          effort: null,
          prompt: "one",
          attachments: [],
        })
      );
      yield* turnDone(0);

      // Nobody has shared anything yet: a solo session credits nobody.
      expect(yield* sessionTrailers(store, sessionId, null)).toEqual([]);

      const share = yield* shares.create(
        {
          target: ShareTarget.cases.Session.make({ sessionId }),
          personId: PERSON,
          inviteeLogin: "octocat",
          role: "contributor",
          expiresAt: null,
          issuer: server.issuer,
          inviteId: INVITE,
          hostCapability: Redacted.make("cap"),
        },
        Actor.cases.Client.make({})
      );

      // The Teammate's device accepts; its statement carries their name and commit email.
      server.list(INVITE, [
        {
          personId: PERSON,
          relayAddress: randomBytes(16).toString("base64url"),
          noiseKey: randomBytes(32).toString("base64url"),
        },
      ]);

      const accepted = yield* Effect.gen(function* () {
        for (let i = 0; i < 400; i++) {
          const found = (yield* shares.every).find((listed) => listed.id === share.id);

          if (found?.person.commitEmail != null) return found;
          yield* Effect.sleep("5 millis");
        }

        return yield* Effect.die(new Error("the Share was never accepted"));
      });

      yield* dispatch(
        Command.cases.SendTurn.make({ sessionId, prompt: "two", attachments: [] }),
        teammateActor(accepted)
      );
      yield* turnDone(1);

      expect(yield* sessionTrailers(store, sessionId, null)).toEqual([TRAILER]);

      // Revoking takes the Teammate's access, not the credit for what they did.
      yield* shares.revoke(share.id, Actor.cases.Client.make({}));
      expect(yield* sessionTrailers(store, sessionId, null)).toEqual([TRAILER]);

      // The Engine tells the agent, so its own commits carry the trailer.
      yield* dispatch(Command.cases.SendTurn.make({ sessionId, prompt: "three", attachments: [] }));
      yield* turnDone(2);
      const prompts = claude.sessions.flatMap((s) => s.turns.map((t) => t.prompt));

      expect(prompts[0]).toBe("one");
      expect(prompts[2]).toEndWith(`not instructions:\n${TRAILER}`);
    }).pipe(Effect.provide(host(server, claude)), Effect.scoped)
  );
});
