import { expect } from "bun:test";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "drizzle-orm";
import { Schema } from "effect";
import { PendingInvite, ShareDevice } from "./api/definition.ts";
import { type Accounts, randomNoiseKey, readJson, startAccounts } from "./testing/harness.ts";
import { postgresSuite } from "./testing/postgresTests.ts";

const { afterAll, beforeAll, describe, test } = postgresSuite();

const owner = {
  id: 1,
  login: "lucas",
  name: "Lucas",
  emails: [{ email: "lucas@example.com", primary: true, verified: true }],
};

const teammate = {
  id: 2,
  login: "alex",
  name: "Alex",
  emails: [{ email: "alex@example.com", primary: true, verified: true }],
};

const stranger = {
  id: 3,
  login: "sam",
  name: "Sam",
  emails: [{ email: "sam@example.com", primary: true, verified: true }],
};

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const Devices = Schema.Array(ShareDevice);

let accounts: Accounts;

let ownerToken: string;

let teammateToken: string;

let strangerToken: string;

beforeAll(async () => {
  accounts = await startAccounts();
  ownerToken = (await accounts.signIn(owner)).token;
  teammateToken = (await accounts.signIn(teammate)).token;
  strangerToken = (await accounts.signIn(stranger)).token;
}, 60_000);

afterAll(() => accounts.stop());

const Created = Schema.Struct({ inviteId: Schema.String, hostCapability: Schema.String });

const invite = (
  overrides: Partial<Record<"inviteeLogin" | "expiresAt" | "role", string>> = {},
  host: { relayUrl?: string | null } = {}
) =>
  accounts.call("POST", "/v1/invites", {
    token: ownerToken,
    body: {
      inviteeLogin: "Alex",
      share: { id: "session-1", title: "Fix the flaky test", kind: "session" },
      host: {
        name: "Mac Studio",
        relayAddress: "relay-host-1",
        noiseKey: randomNoiseKey(),
        ...host,
      },
      role: "contributor",
      expiresAt: inDays(7),
      ...overrides,
    },
  });

const created = async () => readJson(await invite(), Created);

const devices = (
  inviteId: string,
  capability: string,
  headers: Record<string, string> = {},
  wait?: number
) =>
  accounts.call(
    "GET",
    `/v1/shares/${inviteId}/devices${wait === undefined ? "" : `?wait=${wait}`}`,
    {
      capability,
      headers,
    }
  );

describe("invites", () => {
  test("invite, accept, and the host's capability lists the accepted device with its statement", async () => {
    const { inviteId, hostCapability } = await created();

    const before = await devices(inviteId, hostCapability);
    expect(await before.json()).toEqual([]);

    const pending = await readJson(
      await accounts.call("GET", "/v1/invites", { token: teammateToken }),
      Schema.Array(PendingInvite)
    );

    expect(pending.map((p) => p.inviteId)).toEqual([inviteId]);
    expect(pending[0]).toMatchObject({
      owner: { login: "lucas", name: "Lucas" },
      share: { id: "session-1", title: "Fix the flaky test", kind: "session" },
      host: { name: "Mac Studio" },
      role: "contributor",
    });

    const deviceKey = randomNoiseKey();

    const accepted = await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token: teammateToken,
      body: { relayAddress: "relay-alex-laptop", noiseKey: deviceKey },
    });

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      host: { name: "Mac Studio", relayAddress: "relay-host-1" },
      share: { id: "session-1" },
      role: "contributor",
    });

    const listed = await devices(inviteId, hostCapability);
    expect(listed.headers.get("etag")).not.toBeNull();
    const [device, ...rest] = await readJson(listed, Devices);
    expect(rest).toEqual([]);
    expect(device).toMatchObject({ relayAddress: "relay-alex-laptop", noiseKey: deviceKey });

    const jwks = createRemoteJWKSet(new URL(`${accounts.origin}/api/auth/jwks`));
    const { payload } = await jwtVerify(device?.statement ?? "", jwks, { issuer: accounts.origin });
    expect(payload).toMatchObject({
      sub: device?.personId,
      cnf: { noiseKey: deviceKey },
      login: "alex",
    });

    const after = await accounts.call("GET", "/v1/invites", { token: teammateToken });
    expect(await after.json()).toEqual([]);
  });

  test("a second device of the teammate accepts the same invite and joins the list", async () => {
    const { inviteId, hostCapability } = await created();
    const keys = [randomNoiseKey(), randomNoiseKey()];

    for (const [i, noiseKey] of keys.entries()) {
      const r = await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
        token: teammateToken,
        body: { relayAddress: `relay-${i}`, noiseKey },
      });

      expect(r.status).toBe(200);
    }

    const listed = await readJson(await devices(inviteId, hostCapability), Devices);
    expect(listed.map((d) => d.noiseKey)).toEqual(keys);
  });

  test("a waiting host is woken by the accept, and answers 304 when nothing changed", async () => {
    const { inviteId, hostCapability } = await created();
    const etag = (await devices(inviteId, hostCapability)).headers.get("etag") ?? "";

    const unchanged = await devices(inviteId, hostCapability, { "if-none-match": etag }, 0);
    expect(unchanged.status).toBe(304);

    const started = Date.now();
    const waiting = devices(inviteId, hostCapability, { "if-none-match": etag }, 30);
    await Bun.sleep(50);
    const noiseKey = randomNoiseKey();
    await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token: teammateToken,
      body: { relayAddress: "relay-x", noiseKey },
    });
    const woken = await waiting;
    expect(woken.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(woken.headers.get("etag")).not.toBe(etag);
    expect((await readJson(woken, Devices)).map((d) => d.noiseKey)).toEqual([noiseKey]);
  });

  test("declining empties the list, and a declined invite can't be accepted", async () => {
    const { inviteId, hostCapability } = await created();
    await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token: teammateToken,
      body: { relayAddress: "relay-y", noiseKey: randomNoiseKey() },
    });

    const declined = await accounts.call("POST", `/v1/invites/${inviteId}/decline`, {
      token: teammateToken,
    });

    expect(declined.status).toBe(204);
    expect(await (await devices(inviteId, hostCapability)).json()).toEqual([]);

    const again = await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token: teammateToken,
      body: { relayAddress: "relay-y", noiseKey: randomNoiseKey() },
    });

    expect(again.status).toBe(409);
  });

  test("revoking the capability ends it at once", async () => {
    const { inviteId, hostCapability } = await created();

    const revoked = await accounts.call("DELETE", `/v1/shares/${inviteId}/devices`, {
      capability: hostCapability,
    });

    expect(revoked.status).toBe(204);
    expect((await devices(inviteId, hostCapability)).status).toBe(401);

    const accept = await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token: teammateToken,
      body: { relayAddress: "relay-z", noiseKey: randomNoiseKey() },
    });

    expect(accept.status).toBe(409);
  });

  test("only the invitee answers an invite, and a capability reads only its own share", async () => {
    const first = await created();
    const second = await created();

    const byStranger = await accounts.call("POST", `/v1/invites/${first.inviteId}/accept`, {
      token: strangerToken,
      body: { relayAddress: "relay-s", noiseKey: randomNoiseKey() },
    });

    expect(byStranger.status).toBe(404);
    expect((await devices(second.inviteId, first.hostCapability)).status).toBe(401);
    expect((await devices(first.inviteId, "made-up")).status).toBe(401);
    expect((await devices(first.inviteId, "")).status).toBe(401);
  });

  test("an invite needs a known person other than the owner and an expiry within 30 days", async () => {
    expect((await invite({ inviteeLogin: "nobody" })).status).toBe(404);
    expect((await invite({ inviteeLogin: "lucas" })).status).toBe(400);
    expect((await invite({ expiresAt: inDays(31) })).status).toBe(400);
    expect((await invite({ expiresAt: inDays(-1) })).status).toBe(400);
    expect((await invite({ expiresAt: "soon" })).status).toBe(400);
    expect((await invite({ role: "owner" })).status).toBe(400);
  });

  const RelayUrl = Schema.NullOr(Schema.String);

  const acceptedHost = async (host: { relayUrl?: string | null }) => {
    const { inviteId, relayUrl } = await readJson(
      await invite({}, host),
      Schema.Struct({ inviteId: Schema.String, relayUrl: RelayUrl })
    );

    const accepted = await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token: teammateToken,
      body: { relayAddress: "relay-alex-desk", noiseKey: randomNoiseKey() },
    });

    const answer = await readJson(
      accepted,
      Schema.Struct({ host: Schema.Struct({ relayUrl: RelayUrl }) })
    );

    return { created: relayUrl, accepted: answer.host.relayUrl };
  };

  test("an Invite carries the owner Host's relay URL to the Teammate who accepts it", async () => {
    expect(await acceptedHost({ relayUrl: "wss://relay.example.com/v1" })).toEqual({
      created: "wss://relay.example.com/v1",
      accepted: "wss://relay.example.com/v1",
    });
    expect(await acceptedHost({ relayUrl: "ws://127.0.0.1:4433" })).toEqual({
      created: "ws://127.0.0.1:4433",
      accepted: "ws://127.0.0.1:4433",
    });
    // An older Client sends no relayUrl: the Invite is on Polaris Cloud.
    expect(await acceptedHost({})).toEqual({ created: null, accepted: null });
    expect(await acceptedHost({ relayUrl: null })).toEqual({ created: null, accepted: null });
  });

  test.each([
    ["ws://relay.example.com", "wss://, or ws:// on a loopback host"],
    ["https://relay.example.com", "wss://, or ws:// on a loopback host"],
    ["wss://user:secret@relay.example.com", "username or password"],
    ["relay.example.com", "isn't a URL"],
  ])("an Invite with relayUrl %p is refused", async (relayUrl, message) => {
    const response = await invite({}, { relayUrl });
    expect(response.status).toBe(400);
    const refusal = Schema.Struct({ _tag: Schema.String, message: Schema.String });
    const body = Schema.decodeUnknownSync(refusal)(await response.json());
    expect(body._tag).toBe("InvalidInvite");
    expect(body.message).toContain(message);
  });
});

test("an accept racing a revoke never brings the capability back", async () => {
  const shares = await Promise.all(Array.from({ length: 10 }, () => created()));
  await Promise.all(
    shares.flatMap(({ inviteId, hostCapability }) => [
      accounts.call("DELETE", `/v1/shares/${inviteId}/devices`, { capability: hostCapability }),
      accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
        token: teammateToken,
        body: { relayAddress: "relay-race", noiseKey: randomNoiseKey() },
      }),
    ])
  );

  const after = await Promise.all(
    shares.map(({ inviteId, hostCapability }) => devices(inviteId, hostCapability))
  );

  expect(after.map((r) => r.status)).toEqual(shares.map(() => 401));
});

test("an invite to a login someone renamed away from goes to whoever holds it on GitHub now", async () => {
  const before = { id: 5001, login: "morgan", name: "Morgan", emails: [] };
  const beforeToken = (await accounts.signIn(before)).token;
  accounts.github.rename(5001, "morgan-old");

  const holderToken = (await accounts.signIn({ id: 5002, login: "morgan", name: "M2", emails: [] }))
    .token;

  const { inviteId } = await readJson(await invite({ inviteeLogin: "morgan" }), Created);

  const pendingFor = async (token: string) =>
    (
      await readJson(
        await accounts.call("GET", "/v1/invites", { token }),
        Schema.Array(PendingInvite)
      )
    ).map((p) => p.inviteId);

  expect(await pendingFor(holderToken)).toEqual([inviteId]);
  expect(await pendingFor(beforeToken)).toEqual([]);

  const byFormerHolder = await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
    token: beforeToken,
    body: { relayAddress: "relay-m", noiseKey: randomNoiseKey() },
  });

  expect(byFormerHolder.status).toBe(404);
});

describe("a device leaves the Share when its session ends", () => {
  const acceptOnNewSession = async () => {
    const { inviteId, hostCapability } = await created();
    const { token } = await accounts.signIn(teammate);
    const noiseKey = randomNoiseKey();
    await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token,
      body: { relayAddress: "relay-laptop", noiseKey },
    });
    const listed = await devices(inviteId, hostCapability);
    expect((await readJson(listed, Devices)).map((d) => d.noiseKey)).toEqual([noiseKey]);

    return { inviteId, hostCapability, token, etag: listed.headers.get("etag") ?? "" };
  };

  test("signing out drops the device and its statements, and wakes a waiting Host", async () => {
    const { inviteId, hostCapability, token, etag } = await acceptOnNewSession();

    const signedOut = await fetch(`${accounts.origin}/api/auth/sign-out`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin: accounts.origin },
    });

    expect(signedOut.status).toBe(200);
    const started = Date.now();
    const after = await devices(inviteId, hostCapability, { "if-none-match": etag }, 30);
    expect(after.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(6000);
    expect(await after.json()).toEqual([]);
  });

  test("an expired session's device is dropped too", async () => {
    const { inviteId, hostCapability, token } = await acceptOnNewSession();
    await accounts.db.execute(
      sql`update session set expires_at = now() - interval '1 second' where token = ${token}`
    );

    expect(await (await devices(inviteId, hostCapability)).json()).toEqual([]);
  });

  test("the teammate's other devices stay on the Share", async () => {
    const { inviteId, hostCapability } = await created();
    const stays = randomNoiseKey();
    await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token: teammateToken,
      body: { relayAddress: "relay-desk", noiseKey: stays },
    });
    const { token } = await accounts.signIn(teammate);
    await accounts.call("POST", `/v1/invites/${inviteId}/accept`, {
      token,
      body: { relayAddress: "relay-laptop", noiseKey: randomNoiseKey() },
    });
    await fetch(`${accounts.origin}/api/auth/sign-out`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin: accounts.origin },
    });

    const listed = await readJson(await devices(inviteId, hostCapability), Devices);
    expect(listed.map((d) => d.noiseKey)).toEqual([stays]);
  });
});
