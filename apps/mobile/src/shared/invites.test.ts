import { describe, expect, test } from "bun:test";
import type { AccountRecord, PendingInvite, Person } from "@polaris/client/accounts";
import { POLARIS_CLOUD_RELAY_URL } from "@polaris/protocol";
import { inviteRows, sharedGroups } from "./invites.ts";
import { type AcceptedShare, relayUrlOf, sharedHostKey, sharedStore } from "./store.ts";

const account = (
  id: string,
  login: string,
  fields: Partial<AccountRecord> = {}
): AccountRecord => ({
  id,
  server: "https://auth.polaris.lux.dev",
  personId: `p-${login}`,
  login,
  name: null,
  avatarUrl: null,
  commitEmail: `${login}@work.dev`,
  commitEmails: [`${login}@work.dev`],
  signedInAt: 0,
  signedOutAt: null,
  ...fields,
});

const lucas: Person = { personId: "p-lucas", login: "lucas", name: "Lucas Doell", avatarUrl: null };

const ana: Person = { personId: "p-ana", login: "ana", name: null, avatarUrl: null };

const invite = (id: string): PendingInvite => ({
  inviteId: id,
  owner: lucas,
  share: { id: "s-1", title: "Polaris planning", kind: "session" },
  host: { name: "Mac Studio" },
  role: "commenter",
  expiresAt: "2026-11-23T00:00:00.000Z",
});

const accepted = (
  inviteId: string,
  owner = lucas,
  fields: Partial<AcceptedShare> = {}
): AcceptedShare => ({
  accountId: "a1",
  personId: "p-maya",
  inviteId,
  host: { name: "Mac Studio", relayAddress: `addr-${owner.login}`, noiseKey: `key-${owner.login}` },
  share: { id: `s-${inviteId}`, title: `Session ${inviteId}`, kind: "session" },
  role: "contributor",
  owner,
  ...fields,
});

describe("Invites", () => {
  test("an Invite names the address accepting credits, and the Account only when there are two", () => {
    const one = inviteRows([account("a1", "maya")], new Map([["a1", [invite("i1")]]]));

    expect(one[0]).toMatchObject({
      owner: "Lucas Doell",
      title: "Polaris planning",
      role: "Commenter",
      credit: "Accepting credits your work here to maya@work.dev",
      through: null,
    });

    const two = inviteRows(
      [account("a1", "maya"), account("a2", "maya-personal")],
      new Map([["a2", [invite("i2")]]])
    );

    expect(two.map((row) => row.through)).toEqual(["@maya-personal"]);
  });
});

describe("Shared with you", () => {
  test("Shares group by owner, sorted by name, each saying when its Host is offline", () => {
    const shares = [accepted("1"), accepted("2", ana), accepted("3")];
    const down = sharedHostKey(shares[1]!);
    const groups = sharedGroups(shares, [account("a1", "maya")], (key) => key === down);

    expect(groups.map((g) => [g.owner, g.rows.map((r) => [r.title, r.offline])])).toEqual([
      ["ana", [["Session 2", true]]],
      [
        "Lucas Doell",
        [
          ["Session 1", false],
          ["Session 3", false],
        ],
      ],
    ]);
  });

  test("a signed-out Account's Shares leave the list", () => {
    const out = account("a1", "maya", { signedOutAt: 1 });

    expect(sharedGroups([accepted("1")], [out], () => false)).toEqual([]);
  });
});

describe("the owner's relay", () => {
  const host = accepted("1").host;

  test("is the Invite's when it is wss, else Polaris Cloud's", () => {
    expect(relayUrlOf(host)).toBe(POLARIS_CLOUD_RELAY_URL);
    expect(relayUrlOf({ ...host, relayUrl: "wss://relay.team.dev/v1" })).toBe(
      "wss://relay.team.dev/v1"
    );
    expect(relayUrlOf({ ...host, relayUrl: "ws://127.0.0.1:7443/v1" })).toBe(
      "ws://127.0.0.1:7443/v1"
    );
    expect(relayUrlOf({ ...host, relayUrl: "ws://relay.team.dev/v1" })).toBe(
      POLARIS_CLOUD_RELAY_URL
    );
  });
});

describe("the store", () => {
  const keychain = () => {
    const held = new Map<string, string>();

    return {
      get: (key: string) => Promise.resolve(held.get(key) ?? null),
      set: (key: string, value: string) => Promise.resolve(void held.set(key, value)),
      delete: (key: string) => Promise.resolve(void held.delete(key)),
    };
  };

  test("an Invite accepted again replaces itself; signing an Account out forgets its Shares", async () => {
    const store = sharedStore(keychain());
    await store.add(accepted("1"));
    await store.add(accepted("1", lucas, { role: "commenter" }));
    await store.add(accepted("2", ana, { accountId: "a2" }));

    expect((await store.load()).map((s) => [s.inviteId, s.role])).toEqual([
      ["1", "commenter"],
      ["2", "contributor"],
    ]);
    expect((await store.forgetAccount("a1")).map((s) => s.inviteId)).toEqual(["2"]);
  });

  test("a relay URL the Invite named survives the Keychain", async () => {
    const store = sharedStore(keychain());
    const named = accepted("1");
    await store.add({ ...named, host: { ...named.host, relayUrl: "wss://relay.team.dev/v1" } });

    expect((await store.load())[0]?.host.relayUrl).toBe("wss://relay.team.dev/v1");
  });
});
