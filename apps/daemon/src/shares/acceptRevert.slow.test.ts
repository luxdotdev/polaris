/**
 * Accepting Turns as a Contributor (ENG-941, ADR 0112) through the real Share gate, `dispatch`
 * handler and Engine on a real repository: a plain accept is theirs; reverting later Turns
 * writes the owner's files, so only the owner may.
 */
import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  Actor,
  Command,
  CommandId,
  CommandRejected,
  Dispatch,
  InviteId,
  NotFound,
  NotGranted,
  PersonId,
  REVERT_IS_THE_OWNERS,
  SessionId,
  SessionPlacement,
  ShareGate,
  ShareTarget,
  type TurnId,
} from "@polaris/protocol";
import { RelayAddress } from "@polaris/protocol/relay";
import { Effect, Layer, Redacted, Schema } from "effect";
import { RpcGroup, RpcTest } from "effect/rpc";
import { EngineRpcHandlers } from "../engine/rpc.ts";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  tempDir as engineDir,
  waitFor,
} from "../engine/testing.ts";
import { CheckpointsLive } from "../git/Checkpoints.ts";
import { makeRepo, removeTempDir, write } from "../git/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { tempDir } from "../platform/tempDir.testing.ts";
import { HostSecrets } from "../secrets/index.ts";
import { EventStore } from "../store/EventStore.ts";
import { type TeammateDevice, TeammateConnections } from "./connection.ts";
import { shareGateFor } from "./gate.ts";
import { CommitIdentitiesLive } from "./identities.ts";
import { type FakeIssuer, startFakeIssuer } from "./issuer.testing.ts";
import { Shares } from "./service.ts";
import { sharesLayer } from "./live.ts";
import { ShareStore } from "./store.ts";
import { ShareTargetsLive } from "./targets.ts";

const cleanup: Array<() => void> = [];

afterEach(() => {
  cleanup.splice(0).forEach((undo) => undo());
});

const sessionId = SessionId.make("s-revert");

const PERSON = PersonId.make("p-ana");

const INVITE = InviteId.make("inv_revert");

const OWNER = Actor.cases.Client.make({});

/** `dispatch` as a Teammate's connection reaches it: behind the Share gate. */
const Gated = RpcGroup.make(
  Dispatch.setError(Schema.Union([CommandRejected, NotFound, NotGranted]))
).middleware(ShareGate);

/** The connection's person: the owner's own Client, or Ana's device once she joins. */
let caller: TeammateDevice | null = null;

/** The Daemon's own wiring: the Engine on a real repository, the Share service, the gate. */
const host = (server: FakeIssuer, repo: string) => {
  const claude = makeFakeDriver("claude", {
    onTurn: (input) => {
      write(repo, `${input.prompt}.txt`, `${input.prompt}\n`);

      return [
        HarnessEvent.TurnStarted({ turnId: input.turnId, prompt: input.prompt }),
        HarnessEvent.TurnEnded({ turnId: input.turnId, status: "completed", error: null }),
      ];
    },
  });

  const engine = engineLayer({
    filename: join(engineDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [claude],
    checkpoints: CheckpointsLive,
  }).pipe(Layer.provideMerge(CommitIdentitiesLive));

  const shares = sharesLayer({
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

  const services = ShareTargetsLive.pipe(Layer.provideMerge(Layer.merge(engine, shares)));

  const gate = Layer.effect(
    ShareGate,
    Effect.map(Shares, (live) =>
      shareGateFor({ shares: live, teammateOf: () => caller, hostId: "host-1" })
    )
  );

  return Layer.mergeAll(gate, EngineRpcHandlers).pipe(Layer.provideMerge(services));
};

/** Registers `repo` and runs one Turn per prompt; each writes `<prompt>.txt`. */
const runTurns = (repo: string, prompts: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const engine = yield* Engine;

    const dispatch = (command: Command) =>
      engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" });

    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => m.workspaces.size > 0);

    for (const [i, prompt] of prompts.entries()) {
      yield* dispatch(
        i === 0
          ? Command.cases.StartSession.make({
              sessionId,
              workspaceId: [...model.workspaces.keys()][0]!,
              harness: "claude",
              placement: SessionPlacement.cases.InPlace.make({}),
              permissionMode: "supervised",
              model: null,
              effort: null,
              prompt,
              attachments: [],
            })
          : Command.cases.SendTurn.make({ sessionId, prompt, attachments: [] })
      );
      yield* waitFor((m) => {
        const turn = m.sessions.get(sessionId)?.turns[i];

        return turn?.status === "completed" && turn.checkpointAfter !== null;
      }, 5000);
    }

    const done = yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");

    return done.sessions.get(sessionId)!.turns.map((t) => t.id);
  });

/** Ana's Contributor Share of the session, accepted on her device. */
const shareWithAna = (server: FakeIssuer) =>
  Effect.gen(function* () {
    const shares = yield* Shares;
    const relayAddress = randomBytes(16).toString("base64url");
    const noiseKey = randomBytes(32).toString("base64url");

    server.invite(INVITE, "cap");

    const share = yield* shares.create(
      {
        target: ShareTarget.cases.Session.make({ sessionId }),
        personId: PERSON,
        inviteeLogin: "ana",
        role: "contributor",
        expiresAt: null,
        issuer: server.issuer,
        inviteId: INVITE,
        hostCapability: Redacted.make("cap"),
      },
      OWNER
    );

    server.list(INVITE, [{ personId: PERSON, relayAddress, noiseKey }]);

    const device: TeammateDevice = {
      issuer: server.issuer,
      personId: PERSON,
      noiseKey,
      relayAddress: RelayAddress.make(relayAddress),
    };

    for (let i = 0; i < 400 && shares.sharesOf(device).length === 0; i++)
      yield* Effect.sleep("5 millis");

    expect(shares.sharesOf(device).map((s) => s.id)).toEqual([share.id]);

    return device;
  });

const acceptedThrough = Effect.map(
  Effect.flatMap(EventStore, (store) => store.model),
  (model) => model.sessions.get(sessionId)!.session.acceptedThroughIndex
);

test("a Contributor accepts Turns but can't revert later ones; the owner still reverts", async () => {
  const server = await startFakeIssuer();
  const repo = await makeRepo();
  cleanup.push(
    () => server.stop(),
    () => removeTempDir(repo),
    () => {
      caller = null;
    }
  );
  const exists = (name: string) => existsSync(join(repo, `${name}.txt`));

  await Effect.runPromise(
    Effect.gen(function* () {
      const turns = yield* runTurns(repo, ["keep", "mid", "drop"]);
      caller = yield* shareWithAna(server);
      const rpc = yield* RpcTest.makeClient(Gated);

      const accept = (through: TurnId, revertLaterTurns: boolean) =>
        rpc.dispatch({
          commandId: CommandId.make(cid()),
          command: Command.cases.AcceptTurns.make({
            sessionId,
            throughTurnId: through,
            revertLaterTurns,
          }),
        });

      // Ana's revert is refused before anything is recorded or written.
      const refused = yield* Effect.flip(accept(turns[0]!, true));
      expect(refused).toBeInstanceOf(NotGranted);
      expect(refused.message).toBe(REVERT_IS_THE_OWNERS);
      expect(yield* acceptedThrough).toBeNull();
      expect([exists("keep"), exists("mid"), exists("drop")]).toEqual([true, true, true]);

      // Her plain accept goes through, and leaves the files as they are.
      yield* accept(turns[0]!, false);
      expect(yield* acceptedThrough).toBe(0);
      expect(exists("drop")).toBe(true);

      // The owner's own Client reverts what came after.
      caller = null;
      yield* accept(turns[1]!, true);
      expect(yield* acceptedThrough).toBe(1);

      for (let i = 0; i < 100 && exists("drop"); i++) yield* Effect.sleep("20 millis");
      expect([exists("keep"), exists("mid"), exists("drop")]).toEqual([true, true, false]);
    }).pipe(Effect.provide(host(server, repo)), Effect.scoped)
  );
}, 30_000);
