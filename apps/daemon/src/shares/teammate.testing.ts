/**
 * A Daemon behind a real relay process and a fake Account Server over HTTP, a Teammate's
 * session to it, and how its requests end: shared by the Shares slow tests.
 */
import { TEST_USER_KEY } from "../transport/userAccess.testing.ts";
import { join } from "node:path";
import { connectRpcWith, socketTransport } from "@polaris/client";
import {
  Actor,
  Command,
  CommandId,
  CommandRejected,
  NotFound,
  CommentId,
  ConstellationId,
  ConstellationSetState,
  ConstellationPlan,
  DaemonRpcs,
  InviteId,
  ListShares,
  PersonId,
  ReadFile,
  type RelayRouteStatus,
  RevokeUserAccess,
  SessionId,
  type Share,
  ShareGate,
  type ShareRole,
  ShareTarget,
  type ShareTouch,
  SubscribeHost,
  TeammateRpcs,
} from "@polaris/protocol";
import { fromBase64Url, toBase64Url } from "@polaris/protocol/relay";
import { Effect, Exit, Layer, Option, Redacted, Schema, Scope, Stream } from "effect";
import { RpcGroup } from "effect/rpc";
import {
  DeviceSocket,
  handshake,
  sessionTransport,
  startRelay,
  type TestDevice,
} from "../linkedDevices/device.testing.ts";
import { newTempDir, removeTempDirSettled } from "../platform/tempDir.testing.ts";
import { HostSecrets } from "../secrets/index.ts";
import { ServerRpcs } from "../transport/rpcs.ts";
import { startServer } from "../transport/server.ts";
import { WorkingTreeFallback } from "../git/diffScope.ts";
import { RequestShare } from "./connection.ts";
import { type FakeIssuer, startFakeIssuer, type StatementOptions } from "./issuer.testing.ts";
import { Shares } from "./service.ts";

export const PERSON = PersonId.make("p1");

export const S1 = SessionId.make("s1");

export const S2 = SessionId.make("s2");

export const LEAD = SessionId.make("lead");

export const WORKER = SessionId.make("w1");

export const LATER = SessionId.make("w2");

export const C1 = ConstellationId.make("c1");

/** The Host's sessions: two on their own, and a Constellation's Lead and Workers. */
export const touches = new Map<SessionId, ShareTouch>([
  [S1, { sessionId: S1, constellationId: null }],
  [S2, { sessionId: S2, constellationId: null }],
  [LEAD, { sessionId: LEAD, constellationId: C1 }],
  [WORKER, { sessionId: WORKER, constellationId: C1 }],
]);

export const targets = Layer.effectDiscard(
  Effect.map(Shares, (shares) =>
    shares.bindTargets({
      session: (id) =>
        Effect.sync(() => {
          const touch = touches.get(id);

          return touch === undefined ? null : { touch, cwd: "/repo", worker: id === WORKER };
        }),
      hasConstellation: (id) => Effect.succeed(id === C1),
      // Of S1's Turns, `done` has ended and `live` is working.
      turn: (sessionId, turnId) =>
        Effect.succeed(
          sessionId === S1 && (turnId === "done" || turnId === "live")
            ? { index: turnId === "done" ? 1 : 2, working: turnId === "live" }
            : null
        ),
    })
  )
);

/** `dispatch` answers with the Share the gate let it through on; the feed stays open. */
export const handlers = Layer.mergeAll(
  targets,
  ServerRpcs.toLayerHandler("dispatch", ({ commandId }) =>
    Effect.flatMap(Effect.serviceOption(RequestShare), (share) =>
      Effect.fail(
        new CommandRejected({ commandId, reason: JSON.stringify(Option.getOrNull(share)) })
      )
    )
  ),
  // `git.diff` answers whether it may read the working tree, as the gate left it.
  ServerRpcs.toLayerHandler("git.diff", () =>
    Effect.flatMap(WorkingTreeFallback, (allowed) =>
      Effect.fail(new NotFound({ what: "working-tree", id: String(allowed) }))
    )
  ),
  ServerRpcs.toLayerHandler("subscribeSession", () => Stream.never)
);

/** What a Teammate's Client calls, and what only the owner may, so its refusals decode. */
export const Probe = TeammateRpcs.merge(
  RpcGroup.make(
    SubscribeHost,
    ListShares,
    ReadFile,
    RevokeUserAccess,
    ConstellationPlan,
    ConstellationSetState
  ).middleware(ShareGate)
);

export const hello = {
  clientName: "test",
  clientVersion: "0",
  deviceLabel: "Claimed",
  capabilities: [],
};

/** The relay process and the Account Server every test in a file shares. */
export let relay: Awaited<ReturnType<typeof startRelay>>;

export let server: FakeIssuer;

export const startWorld = async () => {
  relay = await startRelay();
  server = await startFakeIssuer({ http: true });
};

export const stopWorld = async () => {
  server.stop();
  await relay.stop();
};

/** A started Daemon with the route on, and its Desktop App connection. */
export const daemon = (scope: Scope.Scope) =>
  Effect.gen(function* () {
    const root = newTempDir("pl-share-", { short: true });
    yield* Scope.addFinalizer(
      scope,
      Effect.promise(() => removeTempDirSettled(root))
    );

    const running = yield* startServer({
      root,
      socketPath: join(root, "d.sock"),
      lockPath: join(root, "d.lock"),
      handlers,
      secrets: HostSecrets.memory(),
      relayDefaultUrl: relay.url,
      shares: { timing: { pauseMs: 20, retryMs: 100 }, skewMs: 0 },
    }).pipe(Scope.provide(scope));

    const desktop = yield* connectRpcWith(
      DaemonRpcs,
      yield* socketTransport(running.socketPath)
    ).pipe(Scope.provide(scope));

    yield* desktop.client.hello({ ...hello, ...TEST_USER_KEY });
    yield* desktop.client["relayRoute.enable"]({});

    for (let i = 0; i < 600; i++) {
      const status: RelayRouteStatus = yield* desktop.client["relayRoute.status"]();

      if (status.connected) return { desktop: desktop.client, status };
      yield* Effect.sleep("25 millis");
    }

    throw new Error("the route never connected");
  });

export type Host = Effect.Success<ReturnType<typeof daemon>>;

export let invites = 0;

/** A Share of `target` for the person, its Invite accepted by `device` on the fake issuer. */
export const shareWith = (
  host: Host,
  device: TestDevice,
  options: {
    readonly target?: ShareTarget;
    readonly role?: ShareRole;
    readonly expiresAt?: string;
    readonly statement?: StatementOptions;
    /** The person the issuer lists the device for. */
    readonly listedAs?: string;
  } = {}
) =>
  Effect.gen(function* () {
    const inviteId = InviteId.make(`inv_${invites++}`);
    server.invite(inviteId, "cap");

    const share: Share = yield* host.desktop["shares.create"]({
      target: options.target ?? ShareTarget.cases.Session.make({ sessionId: S1 }),
      personId: PERSON,
      inviteeLogin: "octocat",
      role: options.role ?? "contributor",
      expiresAt: options.expiresAt ?? null,
      issuer: server.issuer,
      inviteId,
      hostCapability: Redacted.make("cap"),
    });

    server.list(inviteId, [
      {
        personId: options.listedAs ?? PERSON,
        relayAddress: device.address,
        noiseKey: toBase64Url(device.noise.publicKey),
        statement: options.statement,
      },
    ]);

    return share;
  });

/** Opens the device's session to the Host and a Teammate's client over it; null when refused. */
export const open = (host: Host, device: TestDevice, tries = 6) =>
  Effect.gen(function* () {
    const socket = yield* Effect.promise(() => DeviceSocket.connect(relay.url, device.identity));

    const session = yield* Effect.promise(() =>
      handshake(
        socket,
        {
          address: host.status.hostAddress,
          noiseKey: Option.getOrThrow(fromBase64Url(host.status.hostNoiseKey)),
        },
        device.noise,
        undefined,
        tries
      )
    );

    if (session === null) {
      socket.close();

      return null;
    }

    const connection = yield* connectRpcWith(
      Probe,
      sessionTransport(socket, host.status.hostAddress, session)
    );

    return { socket, client: connection.client };
  });

export const opened = (host: Host, device: TestDevice) =>
  Effect.map(open(host, device), (session) => {
    if (session === null) throw new Error("the Teammate's device was refused");

    return session;
  });

export type Teammate = Effect.Success<ReturnType<typeof opened>>["client"];

export const resolve = (sessionId: SessionId) =>
  Command.cases.ResolveComment.make({ sessionId, commentId: CommentId.make("cm1") });

export const sendTurn = Command.cases.SendTurn.make({
  sessionId: S1,
  prompt: "hi",
  attachments: [],
});

/** What the fake `dispatch` answers with: the Share the gate put on the request. */
export const decodeRan = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ actor: Actor, grant: Schema.Array(Schema.String), role: Schema.String })
  )
);

/** How a command ends: the Share it ran through (as the handler saw it), or the refusal's tag. */
export const outcome = (client: Teammate, command: Command) =>
  Effect.flip(client.dispatch({ commandId: CommandId.make(crypto.randomUUID()), command })).pipe(
    Effect.map((error) => (error instanceof CommandRejected ? decodeRan(error.reason) : error._tag))
  );

/** Whether the connection is gone: a call on it fails or never answers. */
export const cutOff = (client: Teammate, within: `${number} seconds`) =>
  Effect.gen(function* () {
    const deadline = Date.now() + Number.parseInt(within, 10) * 1000;

    while (Date.now() < deadline) {
      const answer = yield* Effect.exit(
        client["account.refreshStatement"]({ statement: Redacted.make("x") }).pipe(
          Effect.timeout("400 millis")
        )
      );

      // A live connection answers with a typed refusal of the statement.
      const live =
        Exit.isFailure(answer) && JSON.stringify(answer.cause).includes("StatementRejected");

      if (!live) return true;
      yield* Effect.sleep("50 millis");
    }

    return false;
  });

export const scoped = <A, E>(body: (scope: Scope.Scope) => Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(Effect.scope, body)));
