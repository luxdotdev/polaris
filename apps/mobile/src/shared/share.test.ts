import { expect, test } from "bun:test";
import type { AccountRecord } from "@polaris/client/accounts";
import { SessionId, ShareTarget } from "@polaris/protocol";
import { Redacted } from "effect";
import { type ShareCalls, shareSession } from "./share.ts";

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
      host: { name: "Mac Studio", relayAddress: "addr", noiseKey: "host-key" },
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
    create: () => {
      created = true;

      return Promise.resolve();
    },
  };

  const refused = await shareSession(
    {
      account,
      host: { name: "Mac Studio", relayAddress: "addr", noiseKey: "k" },
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
