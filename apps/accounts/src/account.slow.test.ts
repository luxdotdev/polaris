import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Schema } from "effect";
import { Me } from "./api/definition.ts";
import {
  type Accounts,
  CookieJar,
  randomNoiseKey,
  readJson,
  startAccounts,
} from "./testing/harness.ts";

const Statement = Schema.Struct({ jwt: Schema.String });

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

  test("sign-in hands a token only to a loopback or polaris: redirect", async () => {
    const { response } = await accounts.browse(
      `${accounts.origin}/sign-in?redirect_uri=${encodeURIComponent("https://attacker.example/cb")}`,
      new CookieJar()
    );

    expect(response.status).toBe(400);
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
