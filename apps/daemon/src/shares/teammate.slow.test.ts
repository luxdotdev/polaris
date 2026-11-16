/**
 * Shares through a real relay process and a fake Account Server over HTTP (ADR 0112): a
 * Teammate's device reaches only its Share's target, by role; the owner's calls are refused;
 * revoking cuts it off at once, and an expiry or a lapsed statement drops it; a device the
 * pinned issuer does not vouch for never gets a session.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { connectRpcWith, socketTransport } from "@polaris/client";
import {
  Actor,
  Command,
  CommandId,
  CommandRejected,
  GitDiffSpec,
  NotFound,
  TurnId,
  StatementRejected,
  CommentId,
  ConstellationId,
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
import { Effect, Exit, Fiber, Layer, Option, Redacted, Schema, Scope, Stream } from "effect";
import { RpcGroup } from "effect/rpc";
import {
  DeviceSocket,
  handshake,
  makeDevice,
  sessionTransport,
  startRelay,
  type TestDevice,
} from "../linkedDevices/device.testing.ts";
import { newTempDir, removeTempDirSettled } from "../platform/tempDir.testing.ts";
import { HostSecrets } from "../secrets/index.ts";
import { ServerRpcs } from "../transport/rpcs.ts";
import { startServer } from "../transport/server.ts";
import { TEST_USER_KEY } from "../transport/userAccess.testing.ts";
import { WorkingTreeFallback } from "../git/diffScope.ts";
import { RequestShare } from "./connection.ts";
import { type FakeIssuer, startFakeIssuer, type StatementOptions } from "./issuer.testing.ts";
import { Shares } from "./service.ts";

const PERSON = PersonId.make("p1");

const S1 = SessionId.make("s1");

const S2 = SessionId.make("s2");

const LEAD = SessionId.make("lead");

const WORKER = SessionId.make("w1");

const LATER = SessionId.make("w2");

const C1 = ConstellationId.make("c1");

/** The Host's sessions: two on their own, and a Constellation's Lead and Workers. */
const touches = new Map<SessionId, ShareTouch>([
  [S1, { sessionId: S1, constellationId: null }],
  [S2, { sessionId: S2, constellationId: null }],
  [LEAD, { sessionId: LEAD, constellationId: C1 }],
  [WORKER, { sessionId: WORKER, constellationId: C1 }],
]);

const targets = Layer.effectDiscard(
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
const handlers = Layer.mergeAll(
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
const Probe = TeammateRpcs.merge(
  RpcGroup.make(SubscribeHost, ListShares, ReadFile, RevokeUserAccess).middleware(ShareGate)
);

const hello = { clientName: "test", clientVersion: "0", deviceLabel: "Claimed", capabilities: [] };

let relay: Awaited<ReturnType<typeof startRelay>>;

let server: FakeIssuer;

beforeAll(async () => {
  relay = await startRelay();
  server = await startFakeIssuer({ http: true });
});

afterAll(async () => {
  server.stop();
  await relay.stop();
});

/** A started Daemon with the route on, and its Desktop App connection. */
const daemon = (scope: Scope.Scope) =>
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

type Host = Effect.Success<ReturnType<typeof daemon>>;

let invites = 0;

/** A Share of `target` for the person, its Invite accepted by `device` on the fake issuer. */
const shareWith = (
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
const open = (host: Host, device: TestDevice, tries = 6) =>
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

const opened = (host: Host, device: TestDevice) =>
  Effect.map(open(host, device), (session) => {
    if (session === null) throw new Error("the Teammate's device was refused");

    return session;
  });

type Teammate = Effect.Success<ReturnType<typeof opened>>["client"];

const resolve = (sessionId: SessionId) =>
  Command.cases.ResolveComment.make({ sessionId, commentId: CommentId.make("cm1") });

const sendTurn = Command.cases.SendTurn.make({ sessionId: S1, prompt: "hi", attachments: [] });

/** What the fake `dispatch` answers with: the Share the gate put on the request. */
const decodeRan = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ actor: Actor, grant: Schema.Array(Schema.String), role: Schema.String })
  )
);

/** How a command ends: the Share it ran through (as the handler saw it), or the refusal's tag. */
const outcome = (client: Teammate, command: Command) =>
  Effect.flip(client.dispatch({ commandId: CommandId.make(crypto.randomUUID()), command })).pipe(
    Effect.map((error) => (error instanceof CommandRejected ? decodeRan(error.reason) : error._tag))
  );

/** Whether the connection is gone: a call on it fails or never answers. */
const cutOff = (client: Teammate, within: `${number} seconds`) =>
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

const scoped = <A, E>(body: (scope: Scope.Scope) => Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(Effect.scope, body)));

test("a Teammate reaches its Share's target as that person, and nothing of the owner's", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);
      const share = yield* shareWith(host, laptop);
      const { client, socket } = yield* opened(host, laptop);

      const greeted = yield* client.hello(hello);

      expect(greeted.userAccess).toBe(false);
      expect(greeted.shares?.map((listed) => listed.id)).toEqual([share.id]);

      const actor = Actor.cases.Teammate.make({
        shareId: share.id,
        personId: PERSON,
        name: "The Octocat",
      });

      // Within the target: the command runs as the Teammate, on the Share's Grant.
      expect(yield* outcome(client, resolve(S1))).toEqual({
        actor,
        grant: [...share.grant],
        role: "contributor",
      });
      // A Contributor's Share holds the `turn` Grant: the Turn is sent as the Teammate too.
      expect(yield* outcome(client, sendTurn)).toEqual({
        actor,
        grant: [...share.grant],
        role: "contributor",
      });
      // Another session, and everything that is the owner's.
      expect(yield* outcome(client, resolve(S2))).toBe("NotShared");
      expect(
        yield* outcome(
          client,
          Command.cases.ArchiveSession.make({ sessionId: S1, deleteMergedBranch: false })
        )
      ).toBe("NotShared");

      const owners = yield* Effect.all([
        Effect.flip(Stream.runHead(client.subscribeHost({ afterSequence: null }))),
        Effect.flip(client["shares.list"]({ target: null })),
        Effect.flip(client["files.read"]({ path: "/etc/hosts", offset: null, length: null })),
        Effect.flip(
          Stream.runHead(
            client.subscribeSession({ sessionId: S2, afterSequence: null, turnLimit: null })
          )
        ),
      ]);

      expect(owners.map((error) => error._tag)).toEqual([
        "NotShared",
        "NotShared",
        "NotShared",
        "NotShared",
      ]);

      // Presence: the owner sees who has the session open, and that they left.
      const watching = yield* Effect.forkScoped(
        Stream.runDrain(
          client.subscribeSession({ sessionId: S1, afterSequence: null, turnLimit: null })
        )
      );

      const present = host.desktop["shares.watchPresence"]({ target: share.target });

      const seen = yield* Stream.runHead(Stream.filter(present, (list) => list.length > 0)).pipe(
        Effect.timeout("5 seconds")
      );

      expect(Option.getOrThrow(seen).map((entry) => entry.actor)).toEqual([actor]);
      yield* Fiber.interrupt(watching);

      const left = yield* Stream.runHead(Stream.filter(present, (list) => list.length === 0)).pipe(
        Effect.timeout("5 seconds")
      );

      expect(Option.getOrThrow(left)).toEqual([]);

      const [listing] = yield* host.desktop["shares.list"]({ target: share.target });

      expect(listing?.log.map((entry) => entry._tag)).toEqual([
        "Invited",
        "Accepted",
        "DeviceAdded",
      ]);
      socket.close();
    })
  );
}, 30_000);

test("a Teammate that presents the owner's user key still holds no user access", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);

      const share = yield* shareWith(host, laptop);
      const { client, socket } = yield* opened(host, laptop);

      // The key the owner's Desktop App enrolled: over a Share it enrols and binds nothing.
      const greeted = yield* client.hello({ ...hello, ...TEST_USER_KEY });

      expect(greeted.userAccess).toBe(false);

      const owner = Option.getOrThrow(yield* Stream.runHead(host.desktop["userAccess.watch"]()));
      const [app] = owner.enrolled;

      expect(owner.enrolled.map((entry) => entry.self)).toEqual([true]);
      expect(owner.requests).toEqual([]);

      // What only the owner may is refused by the Share gate, and its Turn is the Teammate's.
      const refused = yield* Effect.flip(client["userAccess.revoke"]({ id: app!.id }));

      expect(refused._tag).toBe("NotShared");
      expect(yield* outcome(client, sendTurn)).toMatchObject({
        actor: Actor.cases.Teammate.make({
          shareId: share.id,
          personId: PERSON,
          name: "The Octocat",
        }),
      });
      socket.close();
    })
  );
}, 30_000);

test("a Constellation's Share covers its Lead and Workers, later ones too, by its role", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);

      const share = yield* shareWith(host, laptop, {
        target: ShareTarget.cases.Constellation.make({ constellationId: C1 }),
        role: "commenter",
      });

      const { client, socket } = yield* opened(host, laptop);
      yield* client.hello(hello);

      expect(yield* outcome(client, resolve(LEAD))).toMatchObject({ grant: ["read", "comment"] });
      expect(yield* outcome(client, resolve(WORKER))).toMatchObject({
        actor: { shareId: share.id },
      });
      expect(yield* outcome(client, resolve(S1))).toBe("NotShared");
      // A Commenter renames nothing, inside the target or not.
      expect(
        yield* outcome(client, Command.cases.RenameSession.make({ sessionId: LEAD, title: "x" }))
      ).toBe("NotShared");

      // A Worker that joins after the Share was made.
      expect(yield* outcome(client, resolve(LATER))).toBe("NotShared");
      touches.set(LATER, { sessionId: LATER, constellationId: C1 });
      expect(yield* outcome(client, resolve(LATER))).toMatchObject({
        actor: { shareId: share.id },
      });
      touches.delete(LATER);

      // Its own Constellation's feed passes the gate (no Constellations are mounted here); another's doesn't.
      const feeds = yield* Effect.all([
        Effect.flip(
          Stream.runHead(
            client["constellation.subscribe"]({ constellationId: C1, afterSequence: null })
          )
        ),
        Effect.flip(
          Stream.runHead(
            client["constellation.subscribe"]({
              constellationId: ConstellationId.make("c2"),
              afterSequence: null,
            })
          )
        ),
      ]);

      expect(feeds.map((error) => error._tag)).toEqual(["ConstellationRejected", "NotShared"]);
      socket.close();
    })
  );
}, 30_000);

test("revoking a Share cuts its Teammate off at once and refuses the device from then on", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);
      const share = yield* shareWith(host, laptop);
      const { client, socket } = yield* opened(host, laptop);
      yield* client.hello(hello);

      const feed = yield* Effect.forkScoped(
        Effect.exit(
          Stream.runDrain(
            client.subscribeSession({ sessionId: S1, afterSequence: null, turnLimit: null })
          )
        )
      );

      // While the Share stands the connection answers: `cutOff` is no false alarm.
      expect(yield* cutOff(client, "1 seconds")).toBe(false);
      const revokedAt = Date.now();
      yield* host.desktop["shares.revoke"]({ id: share.id });

      expect(yield* cutOff(client, "2 seconds")).toBe(true);
      expect(Date.now() - revokedAt).toBeLessThan(1_500);
      yield* Fiber.interrupt(feed);
      expect(yield* open(host, laptop, 1)).toBeNull();
      expect(server.revoked(InviteId.make(`inv_${invites - 1}`))).toBe(true);
      socket.close();
    })
  );
}, 30_000);

test("an expired Share drops its Teammate and refuses the device", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);

      yield* shareWith(host, laptop, { expiresAt: new Date(Date.now() + 2_500).toISOString() });
      const { client, socket } = yield* opened(host, laptop);
      yield* client.hello(hello);

      expect(yield* outcome(client, resolve(S1))).toHaveProperty("grant");
      expect(yield* cutOff(client, "5 seconds")).toBe(true);
      expect(yield* open(host, laptop, 1)).toBeNull();
      socket.close();
    })
  );
}, 30_000);

test("a statement that lapses drops the connection; a newer one presented in time keeps it", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const lapsing = yield* Effect.promise(makeDevice);
      const renewing = yield* Effect.promise(makeDevice);

      // The fake's list never rolls over, so neither device gets a newer statement from the poll.
      yield* shareWith(host, lapsing, { statement: { ttlS: 3 } });
      yield* shareWith(host, renewing, { statement: { ttlS: 3 } });
      const left = yield* opened(host, lapsing);
      const kept = yield* opened(host, renewing);
      yield* left.client.hello(hello);
      yield* kept.client.hello(hello);

      const newer = yield* Effect.promise(() =>
        server.statement(PERSON, toBase64Url(renewing.noise.publicKey))
      );

      const renewed = yield* kept.client["account.refreshStatement"]({
        statement: Redacted.make(newer),
      });

      expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.now() + 60_000);
      expect(yield* cutOff(left.client, "6 seconds")).toBe(true);
      expect(yield* open(host, lapsing, 1)).toBeNull();
      // Past the first statement's lapse, the renewed connection still answers.
      expect(yield* outcome(kept.client, resolve(S1))).toHaveProperty("grant");
      left.socket.close();
      kept.socket.close();
    })
  );
}, 30_000);

const unvouched: ReadonlyArray<
  readonly [string, { readonly statement?: StatementOptions; readonly listedAs?: string }]
> = [
  [
    "a statement signed by a key the pinned issuer does not publish",
    { statement: { forged: true } },
  ],
  ["a statement from another issuer", { statement: { iss: "https://evil.test" } }],
  ["a statement for another person", { statement: { sub: "p2" } }],
  ["the issuer listing it for another person", { listedAs: "p2" }],
  ["a stale statement", { statement: { ttlS: -30 } }],
];

test.each(unvouched)(
  "a device with %s gets no session",
  async (_, options) => {
    await scoped((scope) =>
      Effect.gen(function* () {
        const host = yield* daemon(scope);
        const intruder = yield* Effect.promise(makeDevice);
        const honest = yield* Effect.promise(makeDevice);

        yield* shareWith(host, intruder, options);
        yield* shareWith(host, honest);
        // The honest device's session proves the Host read the issuer's lists.
        const { socket } = yield* opened(host, honest);

        expect(yield* open(host, intruder, 1)).toBeNull();
        socket.close();
      })
    );
  },
  30_000
);

test("a hello that presents another device's statement is refused and the connection closed", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);
      const other = yield* Effect.promise(makeDevice);

      yield* shareWith(host, laptop);
      const { client, socket } = yield* opened(host, laptop);

      const stolen = yield* Effect.promise(() =>
        server.statement(PERSON, toBase64Url(other.noise.publicKey))
      );

      const refused = yield* Effect.flip(
        client.hello({ ...hello, accountStatement: Redacted.make(stolen) })
      );

      expect(refused).toBeInstanceOf(StatementRejected);
      expect(refused).toMatchObject({ reason: "device" });
      expect(yield* cutOff(client, "3 seconds")).toBe(true);
      socket.close();
    })
  );
}, 30_000);

test("a Teammate's diff names real Turns of the shared session, and reads the working tree only for one still working", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);
      yield* shareWith(host, laptop);
      const { client, socket } = yield* opened(host, laptop);
      yield* client.hello(hello);

      /** "true" or "false" as the handler saw the fallback, or the gate's refusal. */
      const diff = (spec: GitDiffSpec) =>
        Effect.flip(client["git.diff"]({ cwd: "/repo", spec })).pipe(
          Effect.map((error) => (error instanceof NotFound ? error.id : error._tag))
        );

      const turn = (id: string) => TurnId.make(id);
      const one = (id: string) => GitDiffSpec.cases.Turn.make({ sessionId: S1, turnId: turn(id) });

      const run = (first: string, last: string) =>
        GitDiffSpec.cases.Turns.make({
          sessionId: S1,
          firstTurnId: turn(first),
          lastTurnId: turn(last),
        });

      expect(yield* diff(one("done"))).toBe("false");
      expect(yield* diff(one("live"))).toBe("true");
      expect(yield* diff(run("done", "live"))).toBe("true");
      // A last Turn that never ran would have fallen back to the whole working tree.
      expect(yield* diff(run("done", "never-ran"))).toBe("NotShared");
      expect(yield* diff(one("never-ran"))).toBe("NotShared");
      socket.close();
    })
  );
});
