import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "drizzle-orm";
import { Schema } from "effect";
import { Me, Person } from "./api/definition.ts";
import {
  type Accounts,
  CookieJar,
  LOOPBACK,
  randomNoiseKey,
  readJson,
  startAccounts,
} from "./testing/harness.ts";

const Statement = Schema.Struct({ jwt: Schema.String });

const Token = Schema.Struct({ token: Schema.String });

const alex = {
  id: 1001,
  login: "Alex-Doe",
  name: "Alex Doe",
  emails: [
    { email: "alex@work.example", primary: true, verified: true },
    { email: "alex@home.example", primary: false, verified: true },
    { email: "alex@unverified.example", primary: false, verified: false },
  ],
};

let accounts: Accounts;

beforeAll(async () => {
  accounts = await startAccounts();
}, 60_000);

afterAll(() => accounts.stop());

describe("sign-in and statements", () => {
  test("a device signs in with GitHub and gets a statement that verifies against the JWKS", async () => {
    const { token, state } = await accounts.signIn(alex);
    expect(state).toBe("s1");
    const noiseKey = randomNoiseKey();

    const response = await accounts.call("POST", "/v1/statements", { token, body: { noiseKey } });
    expect(response.status).toBe(200);
    const { jwt } = await readJson(response, Statement);

    const jwks = createRemoteJWKSet(new URL(`${accounts.origin}/api/auth/jwks`));
    const { payload, protectedHeader } = await jwtVerify(jwt, jwks, { issuer: accounts.origin });
    expect(protectedHeader.alg).toBe("EdDSA");
    expect(payload).toMatchObject({
      iss: accounts.origin,
      cnf: { noiseKey },
      login: "Alex-Doe",
      name: "Alex Doe",
      avatarUrl: "https://avatars.example/1001",
      commitEmail: "alex@work.example",
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(15 * 60);

    const person = await accounts.call("GET", "/v1/people?login=alex-doe", { token });
    expect(await person.json()).toEqual({
      personId: payload.sub,
      login: "Alex-Doe",
      name: "Alex Doe",
      avatarUrl: "https://avatars.example/1001",
    });
  });

  test("signing in again from the same GitHub account is the same person, in a new session", async () => {
    const first = await accounts.signIn(alex);
    const second = await accounts.signIn(alex, new CookieJar());
    expect(second.token).not.toBe(first.token);

    const ids = await Promise.all(
      [first, second].map(async ({ token }) => {
        const me = await accounts.call("GET", "/v1/me", { token });

        return (await readJson(me, Me)).personId;
      })
    );

    expect(ids[0]).toBe(ids[1]);
  });

  test("a statement needs a session, and its key must be a 32-byte base64url key", async () => {
    const noiseKey = randomNoiseKey();
    expect((await accounts.call("POST", "/v1/statements", { body: { noiseKey } })).status).toBe(
      401
    );
    expect(
      (
        await accounts.call("POST", "/v1/statements", {
          token: "not-a-session",
          body: { noiseKey },
        })
      ).status
    ).toBe(401);
    const { token } = await accounts.signIn(alex);
    expect(
      (await accounts.call("POST", "/v1/statements", { token, body: { noiseKey: "short" } })).status
    ).toBe(400);
  });

  test("sign-in refuses a web redirect, and a device that sends no S256 challenge", async () => {
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    for (const query of [
      `redirect_uri=${encodeURIComponent("https://attacker.example/cb")}&state=s&code_challenge=${challenge}&code_challenge_method=S256`,
      `redirect_uri=${encodeURIComponent(LOOPBACK)}&state=s`,
    ]) {
      const { response } = await accounts.browse(
        `${accounts.origin}/sign-in?${query}`,
        new CookieJar()
      );

      expect(response.status).toBe(400);
    }
  });

  test("finding a person needs a session and an existing login", async () => {
    const { token } = await accounts.signIn(alex);
    expect((await accounts.call("GET", "/v1/people?login=alex-doe")).status).toBe(401);
    const missing = await accounts.call("GET", "/v1/people?login=nobody", { token });
    expect(missing.status).toBe(404);
  });
});

describe("commit email", () => {
  test("defaults to the primary verified address and takes only verified or noreply ones", async () => {
    const { token } = await accounts.signIn(alex);
    const me = await (await accounts.call("GET", "/v1/me", { token })).json();
    expect(me).toMatchObject({
      commitEmail: "alex@work.example",
      commitEmails: [
        "alex@work.example",
        "alex@home.example",
        "1001+Alex-Doe@users.noreply.127.0.0.1",
      ],
    });

    const refused = await accounts.call("PUT", "/v1/me", {
      token,
      body: { commitEmail: "alex@unverified.example" },
    });

    expect(refused.status).toBe(400);

    const noreply = "1001+Alex-Doe@users.noreply.127.0.0.1";
    const set = await accounts.call("PUT", "/v1/me", { token, body: { commitEmail: noreply } });
    expect((await readJson(set, Me)).commitEmail).toBe(noreply);

    const statement = await accounts.call("POST", "/v1/statements", {
      token,
      body: { noiseKey: randomNoiseKey() },
    });

    const { jwt } = await readJson(statement, Statement);

    const { payload } = await jwtVerify(
      jwt,
      createRemoteJWKSet(new URL(`${accounts.origin}/api/auth/jwks`))
    );

    expect(payload["commitEmail"]).toBe(noreply);
  });

  test("a person with no verified address commits as noreply", async () => {
    const { token } = await accounts.signIn({
      id: 2002,
      login: "quiet",
      name: null,
      emails: [{ email: "quiet@example.com", primary: true, verified: false }],
    });

    const me = await (await accounts.call("GET", "/v1/me", { token })).json();
    expect(me).toMatchObject({
      name: "quiet",
      commitEmail: "2002+quiet@users.noreply.127.0.0.1",
      commitEmails: ["2002+quiet@users.noreply.127.0.0.1"],
    });
  });
});

describe("identity is the GitHub account", () => {
  test("an address that moves to another GitHub account never joins it to the first person", async () => {
    const first = {
      id: 3001,
      login: "first",
      name: "First",
      emails: [{ email: "shared@example.com", primary: true, verified: true }],
    };

    const firstToken = (await accounts.signIn(first)).token;
    accounts.github.signInAs({ ...first, emails: [] });

    const second = {
      id: 3002,
      login: "second",
      name: "Second",
      emails: [{ email: "shared@example.com", primary: true, verified: true }],
    };

    const secondToken = (await accounts.signIn(second)).token;

    const [a, b] = await Promise.all(
      [firstToken, secondToken].map(async (token) =>
        readJson(await accounts.call("GET", "/v1/me", { token }), Me)
      )
    );

    expect(a?.personId).not.toBe(b?.personId);
    expect(b).toMatchObject({ login: "second", commitEmail: "shared@example.com" });
  });

  test("a login someone renamed away from finds whoever holds it on GitHub now", async () => {
    const casey = { id: 4001, login: "casey", name: "Casey", emails: [] };
    const caseyToken = (await accounts.signIn(casey)).token;

    const caseyId = (
      await readJson(await accounts.call("GET", "/v1/me", { token: caseyToken }), Me)
    ).personId;

    accounts.github.rename(4001, "casey-new");

    const dana = { id: 4002, login: "casey", name: "Dana", emails: [] };
    const danaToken = (await accounts.signIn(dana)).token;

    const danaId = (await readJson(await accounts.call("GET", "/v1/me", { token: danaToken }), Me))
      .personId;

    const byOldLogin = await readJson(
      await accounts.call("GET", "/v1/people?login=casey", { token: caseyToken }),
      Person
    );

    expect(byOldLogin.personId).toBe(danaId);

    const byNewLogin = await readJson(
      await accounts.call("GET", "/v1/people?login=casey-new", { token: danaToken }),
      Person
    );

    expect(byNewLogin.personId).toBe(caseyId);
  });

  test("signing in again brings the login, name and avatar up to date", async () => {
    const riley = { id: 4101, login: "riley", name: "Riley", emails: [] };
    await accounts.signIn(riley);
    accounts.github.rename(4101, "riley-renamed");
    const { token } = await accounts.signIn({ ...riley, login: "riley-renamed", name: "Riley R" });
    const me = await readJson(await accounts.call("GET", "/v1/me", { token }), Me);
    expect(me).toMatchObject({ login: "riley-renamed", name: "Riley R" });
  });
});

describe("the device's sign-in handoff (RFC 8252)", () => {
  test("the redirect gets a one-use code and the state, never a token", async () => {
    const { code, verifier, url } = await accounts.authorize(alex);
    expect([...url.searchParams.keys()].sort()).toEqual(["code", "state"]);
    expect(url.searchParams.get("state")).toBe("s1");

    const first = await accounts.exchange(code, verifier);
    const { token } = await readJson(first, Token);
    expect((await accounts.call("GET", "/v1/me", { token })).status).toBe(200);

    const again = await accounts.exchange(code, verifier);
    expect(again.status).toBe(400);
  });

  test("a code is worth nothing without its verifier, and a wrong guess spends it", async () => {
    const { code, verifier } = await accounts.authorize(alex);
    expect((await accounts.exchange(code, `${verifier}x`)).status).toBe(400);
    expect((await accounts.exchange(code, verifier)).status).toBe(400);
  });

  test("a code lapses after 60 seconds", async () => {
    const { code, verifier } = await accounts.authorize(alex);
    await accounts.db.execute(
      sql`update sign_in set code_expires_at = now() - interval '1 second'`
    );
    expect((await accounts.exchange(code, verifier)).status).toBe(400);
  });

  test("the completion URL hands out nothing without a sign-in this browser started", async () => {
    const { jar } = await accounts.signIn(alex);

    const direct = await fetch(`${accounts.origin}/sign-in/done`, {
      redirect: "manual",
      headers: { cookie: jar.header() },
    });

    expect(direct.status).toBe(400);
    expect(direct.headers.get("location")).toBeNull();
  });

  test("a browser already signed in still goes through GitHub for each new sign-in", async () => {
    const { jar } = await accounts.signIn(alex);
    const start = new URL(`${accounts.origin}/sign-in`);
    start.searchParams.set("redirect_uri", LOOPBACK);
    start.searchParams.set("state", "s2");
    start.searchParams.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    start.searchParams.set("code_challenge_method", "S256");
    const started = await fetch(start, { redirect: "manual", headers: { cookie: jar.header() } });
    expect(started.status).toBe(302);
    expect(started.headers.get("location")).toStartWith(accounts.github.url);
    jar.keep(started);

    const skipped = await fetch(`${accounts.origin}/sign-in/done`, {
      redirect: "manual",
      headers: { cookie: jar.header() },
    });

    expect(skipped.status).toBe(400);
    expect(skipped.headers.get("location")).toBeNull();
  });
});
