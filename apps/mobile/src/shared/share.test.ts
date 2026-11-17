import { expect, test } from "bun:test";
import type { AccountRecord } from "@polaris/client/accounts";
import { NotFound, NotGranted, SessionId, ShareRefused, ShareTarget } from "@polaris/protocol";
import { Redacted } from "effect";
import { type HostRefusal, type ShareCalls, shareSession } from "./share.ts";

const account: AccountRecord = {
  id: "a1",
  server: "https://auth.team.dev",
  personId: "p-lucas",
  login: "lucas",
  name: "Lucas Doell",
  avatarUrl: null,
  commitEmail: "lucas@team.dev",
  commitEmails: ["lucas@team.dev"],
  signedInAt: 0,
  signedOutAt: null,
};

test("the Share pins the Account Server's person id, its issuer and the Invite's capability", async () => {
  const seen: Array<unknown> = [];

  const calls: ShareCalls = {
    person: (_, login) =>
      Promise.resolve({ personId: `id-of-${login}`, login, name: "Maya Chen", avatarUrl: null }),
    invite: (accountId, invite) => {
      seen.push(["invite", accountId, invite.inviteeLogin, invite.host.noiseKey, invite.role]);

      return Promise.resolve({ inviteId: "inv-1", hostCapability: "cap-secret", relayUrl: null });
    },
    withdraw: () => Promise.reject(new Error("not reached")),
    create: (share) => {
      seen.push([
        "create",
        share.personId,
        share.issuer,
        share.inviteId,
        Redacted.value(share.hostCapability),
        share.target,
      ]);

      return Promise.resolve();
    },
  };

  await shareSession(
    {
      account,
      host: {
        name: "Mac Studio",
        relayAddress: "addr",
        noiseKey: "host-key",
        relayUrl: "wss://relay.team.dev/v1",
      },
      sessionId: "s-1",
      title: "Polaris planning",
      login: " @maya ",
      role: "commenter",
    },
    calls
  );

  expect(seen).toEqual([
    ["invite", "a1", "maya", "host-key", "commenter"],
    [
      "create",
      "id-of-maya",
      "https://auth.team.dev",
      "inv-1",
      "cap-secret",
      ShareTarget.cases.Session.make({ sessionId: SessionId.make("s-1") }),
    ],
  ]);
});

test("no Share is recorded when the person isn't on the Account Server", async () => {
  let created = false;

  const calls: ShareCalls = {
    person: () => Promise.reject(new Error("No one is @nobody on this server")),
    invite: () => Promise.reject(new Error("not reached")),
    withdraw: () => Promise.reject(new Error("not reached")),
    create: () => {
      created = true;

      return Promise.resolve();
    },
  };

  const refused = await shareSession(
    {
      account,
      host: {
        name: "Mac Studio",
        relayAddress: "addr",
        noiseKey: "k",
        relayUrl: "wss://relay.polaris.lux.dev/v1",
      },
      sessionId: "s-1",
      title: "t",
      login: "nobody",
      role: "contributor",
    },
    calls
  ).then(
    () => null,
    (error: Error) => error.message
  );

  expect(refused).toBe("No one is @nobody on this server");
  expect(created).toBe(false);
});

/** Shares with the Host refusing `shares.create`: the copy shown and the Invites withdrawn. */
const refusedShare = async (refusal: HostRefusal | Error, withdraws = true) => {
  const withdrawn: Array<unknown> = [];

  const calls: ShareCalls = {
    person: (_, login) =>
      Promise.resolve({ personId: "p-maya", login, name: null, avatarUrl: null }),
    invite: () =>
      Promise.resolve({ inviteId: "inv-1", hostCapability: "cap-secret", relayUrl: null }),
    withdraw: (accountId, invite) => {
      withdrawn.push([accountId, invite.inviteId, invite.hostCapability]);

      return withdraws ? Promise.resolve() : Promise.reject(new Error("couldn't reach the server"));
    },
    create: () => Promise.reject(refusal),
  };

  const said = await shareSession(
    {
      account,
      host: {
        name: "Mac Studio",
        relayAddress: "addr",
        noiseKey: "k",
        relayUrl: "wss://relay.polaris.lux.dev/v1",
      },
      sessionId: "s-1",
      title: "t",
      login: "maya",
      role: "contributor",
    },
    calls
  ).then(
    () => null,
    (error: Error) => error.message
  );

  return { said, withdrawn };
};

test.each([
  [
    new NotGranted({ what: "shares.create", needed: null }),
    "Mac Studio needs a newer Polaris to share from your phone.",
  ],
  [
    new ShareRefused({ reason: "worker" }),
    "A worker's session is shared through its constellation.",
  ],
  [
    new ShareRefused({ reason: "issuer-unreachable" }),
    "Mac Studio couldn't reach your Polaris account's server. Try again.",
  ],
  [new NotFound({ what: "session", id: "s-1" }), "This session is no longer on Mac Studio."],
  [
    new Error("RpcClientError: Expected string, got undefined"),
    "Mac Studio didn't share the session. Try again.",
  ],
])("a refused Share withdraws its Invite and says so plainly: %p", async (refusal, copy) => {
  expect(await refusedShare(refusal)).toEqual({
    said: copy,
    withdrawn: [["a1", "inv-1", "cap-secret"]],
  });
});

test("a withdraw that fails still shows the Host's refusal", async () => {
  const { said } = await refusedShare(new ShareRefused({ reason: "expiry" }), false);

  expect(said).toBe("A share lasts at most 30 days.");
});
