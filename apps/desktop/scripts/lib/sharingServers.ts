#!/usr/bin/env bun
/**
 * One local Account Server (apps/accounts' harness: a fake GitHub, Postgres in Docker), a real
 * relay (`POLARIS_RELAY_BIN`, else cargo builds apps/relay) and a stand-in system browser, for
 * `sharingE2e.ts`. Prints `SHARING {server, relay, browser}` as one line among its logs, and stops when stdin closes.
 * The browser's `/open?as=<login>&url=` signs that person in on the fake GitHub, follows the
 * redirects with cookies, then loads the loopback return the app is listening on.
 */
import { CookieJar, startAccounts } from "../../../accounts/src/testing/harness.ts";
import { relayBinary } from "../../../relay/contract/testing/binary.ts";

const people = {
  octocat: {
    id: 583_231,
    login: "octocat",
    name: "The Octocat",
    emails: [{ email: "octocat@lux.dev", primary: true, verified: true }],
  },
  hubot: {
    id: 1001,
    login: "hubot",
    name: "Hubot",
    emails: [{ email: "hubot@acme.example", primary: true, verified: true }],
  },
} as const;

const isPerson = (login: string): login is keyof typeof people => Object.hasOwn(people, login);

const server = await startAccounts();

// Everyone who appears in an Invite has signed in to the server once.
for (const person of Object.values(people)) await server.signIn(person);

const port = 20_000 + Math.floor(Math.random() * 20_000);

const relay = Bun.spawn([relayBinary()], {
  env: { ...process.env, PORT: String(port), POLARIS_RELAY_HOSTNAME: "127.0.0.1" },
  stdout: "ignore",
  stderr: "inherit",
});

for (let tries = 0; ; tries++) {
  const up = await fetch(`http://127.0.0.1:${port}/healthz`).then(
    () => true,
    () => false
  );

  if (up) break;

  if (tries > 200) throw new Error("the relay did not start");
  await Bun.sleep(50);
}

const browser = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const params = new URL(request.url).searchParams;
    const target = params.get("url") ?? "";
    const as = params.get("as") ?? "";

    if (!target.startsWith(server.origin) || !isPerson(as))
      return new Response("unknown server or person", { status: 400 });
    server.github.signInAs(people[as]);
    const { url } = await server.browse(target, new CookieJar());
    const loopback = await fetch(url);

    return new Response(await loopback.text(), { status: loopback.status });
  },
});

console.log(
  "SHARING",
  JSON.stringify({
    server: server.origin,
    relay: `ws://127.0.0.1:${port}/v1`,
    browser: `http://127.0.0.1:${browser.port}`,
  })
);

for await (const _ of Bun.stdin.stream()) {
  // Runs until the parent closes stdin.
}

relay.kill();

await browser.stop(true);

await server.stop();
