/**
 * Shares through a real relay process and a fake Account Server over HTTP (ADR 0112): a
 * Teammate's device reaches only its Share's target, by role; the owner's calls are refused;
 * revoking cuts it off at once, and an expiry or a lapsed statement drops it; a device the
 * pinned issuer does not vouch for never gets a session.
 */
import { TEST_USER_KEY } from "../transport/userAccess.testing.ts";
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  Actor,
  Command,
  CommandId,
  GitDiffSpec,
  NotFound,
  TurnId,
  StatementRejected,
  ConstellationId,
  InviteId,
  PushRegistrationError,
  ShareTarget,
  SetConstellationStateAction,
  ReviewAction,
  AttemptId,
} from "@polaris/protocol";
import { type RelayAddress, toBase64Url } from "@polaris/protocol/relay";
import { signPushTicket } from "@polaris/protocol/relay/party";
import { pushSuite } from "../push/seal.ts";
import { Effect, Fiber, Option, Redacted, Stream } from "effect";
import { makeDevice } from "../linkedDevices/device.testing.ts";
import { type StatementOptions } from "./issuer.testing.ts";
import {
  PERSON,
  S1,
  S2,
  LEAD,
  WORKER,
  LATER,
  C1,
  touches,
  hello,
  server,
  startWorld,
  stopWorld,
  daemon,
  invites,
  shareWith,
  open,
  opened,
  resolve,
  sendTurn,
  outcome,
  cutOff,
  scoped,
} from "./teammate.testing.ts";

beforeAll(startWorld);

afterAll(stopWorld);

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

test("a Constellation's Contributor acts through its Lead and registers for its Needs You; the owner's calls stay refused", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);

      yield* shareWith(host, laptop, {
        target: ShareTarget.cases.Constellation.make({ constellationId: C1 }),
      });

      const { client, socket } = yield* opened(host, laptop);
      yield* client.hello(hello);
      const C2 = ConstellationId.make("c2");

      const review = (constellationId: ConstellationId) =>
        Effect.flip(
          client["constellation.review"]({
            commandId: CommandId.make(crypto.randomUUID()),
            constellationId,
            attemptId: AttemptId.make("a1"),
            revision: 0,
            action: ReviewAction.cases.Approve.make({}),
          })
        ).pipe(Effect.map((error) => error._tag));

      // Its own Constellation reaches the handler (none is mounted here); another's doesn't.
      expect(yield* review(C1)).toBe("ConstellationRejected");
      expect(yield* review(C2)).toBe("NotShared");

      // Planning, archiving and the rest of the Constellation's lifecycle stay the owner's.
      const archive = yield* Effect.flip(
        client["constellation.set_state"]({
          commandId: CommandId.make(crypto.randomUUID()),
          constellationId: C1,
          action: SetConstellationStateAction.cases.Archive.make({}),
        })
      );

      const plan = yield* Effect.flip(
        client["constellation.plan"]({
          commandId: CommandId.make(crypto.randomUUID()),
          constellationId: C1,
          operations: [],
        })
      );

      expect([archive._tag, plan._tag]).toEqual(["NotShared", "NotShared"]);

      // Its device registers for push with a ticket its own relay identity signed for this Host.
      const keys = yield* Effect.promise(() => pushSuite.kem.generateKeyPair());

      const pushKey = toBase64Url(
        new Uint8Array(
          yield* Effect.promise(() => pushSuite.kem.serializePublicKey(keys.publicKey))
        )
      );

      const token = "ab".repeat(32);

      const registration = (address: RelayAddress) => ({
        token,
        environment: "sandbox" as const,
        pushKey,
        ticket: signPushTicket(laptop.identity, address, "sandbox", token),
      });

      yield* client["devices.registerPush"](registration(host.status.hostAddress));

      const forged = yield* Effect.flip(
        client["devices.registerPush"](registration(laptop.address))
      );

      expect(forged).toBeInstanceOf(PushRegistrationError);
      expect(forged).toMatchObject({ reason: "failed" });

      // Muting is the Teammate's own, and only for what its Share covers.
      yield* client["shares.mute"]({
        target: ShareTarget.cases.Constellation.make({ constellationId: C1 }),
        muted: true,
      });

      const elsewhere = yield* Effect.flip(
        client["shares.mute"]({
          target: ShareTarget.cases.Constellation.make({ constellationId: C2 }),
          muted: true,
        })
      );

      expect(elsewhere._tag).toBe("NotShared");
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
