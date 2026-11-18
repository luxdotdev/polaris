import { expect } from "bun:test";
import { Schema } from "effect";
import {
  type Accounts,
  CookieJar,
  randomNoiseKey,
  readJson,
  startAccounts,
} from "./testing/harness.ts";
import { postgresSuite } from "./testing/postgresTests.ts";

const { afterAll, beforeAll, test } = postgresSuite();

const DeviceCode = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri_complete: Schema.String,
});

const riley = {
  id: 77,
  login: "riley",
  name: "Riley",
  emails: [{ email: "riley@example.com", primary: true, verified: true }],
};

let accounts: Accounts;

beforeAll(async () => {
  accounts = await startAccounts();
}, 60_000);

afterAll(() => accounts.stop());

const requestCode = async () => {
  const response = await accounts.call("POST", "/api/auth/device/code", {
    body: { client_id: "polaris-mobile" },
  });

  return readJson(response, DeviceCode);
};

const pollToken = (deviceCode: string) =>
  accounts.call("POST", "/api/auth/device/token", {
    body: {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: "polaris-mobile",
    },
  });

const answer = (userCode: string, jar: CookieJar, action: string, origin = accounts.origin) =>
  fetch(`${accounts.origin}/device?user_code=${userCode}`, {
    method: "POST",
    headers: { cookie: jar.header(), origin, "content-type": "application/x-www-form-urlencoded" },
    body: `action=${action}`,
  });

test("a device without a browser signs in by code, approved in a browser signed in with GitHub", async () => {
  const code = await requestCode();

  accounts.github.signInAs(riley);
  const jar = new CookieJar();

  const { response } = await accounts.browse(
    new URL(code.verification_uri_complete, accounts.origin).toString(),
    jar
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Sign in a device as @riley?");

  expect((await answer(code.user_code, jar, "approve", "https://attacker.example")).status).toBe(
    403
  );
  expect((await answer(code.user_code, jar, "approve")).status).toBe(200);

  const token = await readJson(
    await pollToken(code.device_code),
    Schema.Struct({ access_token: Schema.String })
  );

  const statement = await accounts.call("POST", "/v1/statements", {
    token: token.access_token,
    body: { noiseKey: randomNoiseKey() },
  });

  expect(statement.status).toBe(200);
});

test("a refused code never yields a session", async () => {
  const code = await requestCode();
  accounts.github.signInAs(riley);
  const jar = new CookieJar();
  await accounts.browse(new URL(code.verification_uri_complete, accounts.origin).toString(), jar);
  expect((await answer(code.user_code, jar, "deny")).status).toBe(200);
  const polled = await pollToken(code.device_code);
  expect(polled.status).toBe(400);
  expect(await polled.json()).toMatchObject({ error: "access_denied" });
});

test("a code nobody has approved yet keeps the device waiting", async () => {
  const polled = await pollToken((await requestCode()).device_code);
  expect(polled.status).toBe(400);
  expect(await polled.json()).toMatchObject({ error: "authorization_pending" });
});
