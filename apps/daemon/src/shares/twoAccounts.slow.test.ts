/**
 * One device signed in to two Polaris accounts with a Share through each on one Host
 * (ENG-941), through a real relay process, the link, the route and the Share gate.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { connectRpcWith } from "@polaris/client";
import { makeRelayDevice } from "@polaris/client/relay";
import {
  StatementRejected,
  encodeTeammateInit,
  InviteId,
  PersonId,
  type Share,
  ShareTarget,
} from "@polaris/protocol";
import { fromBase64Url, toBase64Url } from "@polaris/protocol/relay";
import { Effect, Option, Redacted } from "effect";
import {
  DeviceSocket,
  makeDevice,
  sessionMux,
  type TestDevice,
} from "../linkedDevices/device.testing.ts";
import { type FakeIssuer, startFakeIssuer } from "./issuer.testing.ts";
import {
  PERSON,
  S1,
  S2,
  Probe,
  relay,
  server,
  startWorld,
  stopWorld,
  daemon,
  shareWith,
  resolve,
  outcome,
  cutOff,
  scoped,
  hello,
  type Host,
} from "./teammate.testing.ts";

beforeAll(startWorld);

afterAll(stopWorld);

const WORK = PersonId.make("p-work");

/** The work Account's server: another issuer than the personal Account's `server`. */
let workServer: FakeIssuer;

beforeEach(async () => {
  workServer = await startFakeIssuer({ http: true });
});

afterEach(() => workServer.stop());

/**
 * S1 shared with the device's personal Account and S2 with its work Account, at another
 * issuer: the same relay address and Noise key listed under two persons.
 */
const sharedTwice = (host: Host, laptop: TestDevice) =>
  Effect.gen(function* () {
    const noiseKey = toBase64Url(laptop.noise.publicKey);
    const personal = yield* shareWith(host, laptop);
    workServer.invite(InviteId.make("inv_work"), "cap");

    const work: Share = yield* host.desktop["shares.create"]({
      target: ShareTarget.cases.Session.make({ sessionId: S2 }),
      personId: WORK,
      inviteeLogin: "octocat",
      role: "contributor",
      expiresAt: null,
      issuer: workServer.issuer,
      inviteId: InviteId.make("inv_work"),
      hostCapability: Redacted.make("cap"),
    });

    workServer.list("inv_work", [{ personId: WORK, relayAddress: laptop.address, noiseKey }]);

    const statement = (issuer: FakeIssuer, personId: string) =>
      Effect.map(
        Effect.promise(() => issuer.statement(personId, noiseKey)),
        Redacted.make
      );

    return {
      personal,
      work,
      personalStatement: yield* statement(server, PERSON),
      workStatement: yield* statement(workServer, WORK),
    };
  });

test("one device signed in to two Accounts holds a connection as each person, and neither statement reaches the other's Shares", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);

      const { personal, work, personalStatement, workStatement } = yield* sharedTwice(host, laptop);

      const socket = yield* Effect.promise(() => DeviceSocket.connect(relay.url, laptop.identity));

      const mux = sessionMux(socket, host.status.hostAddress);
      const hostKey = Option.getOrThrow(fromBase64Url(host.status.hostNoiseKey));

      /** A session whose handshake names `claim`; null when the Host never answers. */
      const connect = (claim: Uint8Array | undefined, tries = 1) =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < tries; attempt++) {
            const transport = yield* Effect.promise(() => mux.open(hostKey, laptop.noise, claim));

            if (transport !== null) return (yield* connectRpcWith(Probe, transport)).client;
          }

          return null;
        });

      const connected = (claim: Uint8Array | undefined) =>
        Effect.map(connect(claim, 8), (client) => {
          if (client === null) throw new Error("the Teammate's device was refused");

          return client;
        });

      const asPersonal = encodeTeammateInit({ issuer: server.issuer, personId: PERSON });
      const asWork = encodeTeammateInit({ issuer: workServer.issuer, personId: WORK });

      const mine = yield* connected(asPersonal);
      const theirs = yield* connected(asWork);

      const greetedMine = yield* mine.hello({ ...hello, accountStatement: personalStatement });
      const greetedWork = yield* theirs.hello({ ...hello, accountStatement: workStatement });

      expect(greetedMine.shares?.map((listed) => listed.id)).toEqual([personal.id]);
      expect(greetedWork.shares?.map((listed) => listed.id)).toEqual([work.id]);

      // Both connections live at once, each acting as its own person on its own Share.
      expect(yield* outcome(mine, resolve(S1))).toMatchObject({
        actor: { shareId: personal.id, personId: PERSON },
      });
      expect(yield* outcome(mine, resolve(S2))).toBe("NotShared");
      expect(yield* outcome(theirs, resolve(S2))).toMatchObject({
        actor: { shareId: work.id, personId: WORK },
      });
      expect(yield* outcome(theirs, resolve(S1))).toBe("NotShared");

      // The other Account's statement on a connection is refused and the connection closed.
      const crossed = yield* connected(asWork);

      const refused = yield* Effect.flip(
        crossed.hello({ ...hello, accountStatement: personalStatement })
      );

      expect(refused).toBeInstanceOf(StatementRejected);
      expect(yield* cutOff(crossed, "3 seconds")).toBe(true);

      // A Client that names nobody is neither person here, whichever statement it presents.
      for (const presented of [personalStatement, workStatement]) {
        const unnamed = yield* connected(undefined);

        const nobody = yield* Effect.flip(unnamed.hello({ ...hello, accountStatement: presented }));

        expect(nobody).toBeInstanceOf(StatementRejected);
        expect(nobody).toMatchObject({ reason: "person" });
        expect(nobody.message).toBe("This host could not confirm who you are");
        expect(yield* cutOff(unnamed, "3 seconds")).toBe(true);
      }

      // A claim the issuers don't back gets no answer: a person at the other's issuer, a stranger.
      const unbacked = [
        encodeTeammateInit({ issuer: workServer.issuer, personId: PERSON }),
        encodeTeammateInit({ issuer: server.issuer, personId: WORK }),
        encodeTeammateInit({ issuer: server.issuer, personId: PersonId.make("p-other") }),
      ];

      for (const claim of unbacked) expect(yield* connect(claim)).toBeNull();

      // None of that touched the personal connection.
      expect(yield* outcome(mine, resolve(S1))).toMatchObject({
        actor: { shareId: personal.id, personId: PERSON },
      });
      socket.close();
    })
  );
}, 60_000);

test("the Client's relay device holds a session as each Account to one Host at once", async () => {
  await scoped((scope) =>
    Effect.gen(function* () {
      const host = yield* daemon(scope);
      const laptop = yield* Effect.promise(makeDevice);
      const shared = yield* sharedTwice(host, laptop);
      const device = makeRelayDevice(laptop);
      yield* Effect.addFinalizer(() => Effect.sync(device.close));

      /** A session as that Account's person, as the Desktop and Mobile Apps open one. */
      const sessionAs = (teammate: { readonly issuer: string; readonly personId: string }) =>
        device
          .transport({
            relayUrl: relay.url,
            hostAddress: host.status.hostAddress,
            hostNoiseKey: host.status.hostNoiseKey,
            teammate,
          })
          .pipe(
            Effect.retry({ times: 3 }),
            Effect.flatMap((transport) => connectRpcWith(Probe, transport)),
            Effect.map((connection) => connection.client)
          );

      const mine = yield* sessionAs({ issuer: server.issuer, personId: PERSON });
      const theirs = yield* sessionAs({ issuer: workServer.issuer, personId: WORK });

      const greeted = yield* Effect.all([
        mine.hello({ ...hello, accountStatement: shared.personalStatement }),
        theirs.hello({ ...hello, accountStatement: shared.workStatement }),
      ]);

      expect(greeted.map((answer) => answer.shares?.map((listed) => listed.id))).toEqual([
        [shared.personal.id],
        [shared.work.id],
      ]);

      // The second session did not take the first one's place: both still answer.
      expect(yield* outcome(mine, resolve(S1))).toMatchObject({ actor: { personId: PERSON } });
      expect(yield* outcome(theirs, resolve(S2))).toMatchObject({ actor: { personId: WORK } });
      expect(yield* outcome(theirs, resolve(S1))).toBe("NotShared");
    })
  );
}, 60_000);
