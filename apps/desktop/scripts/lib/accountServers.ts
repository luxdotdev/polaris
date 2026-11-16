#!/usr/bin/env bun
/**
 * Two local Account Servers (apps/accounts' test harness: a fake GitHub, Postgres in Docker)
 * and a stand-in system browser, for `polarisAccountsScreens.ts`. Run with bun; prints one
 * JSON line, `{ servers: [origin, origin], browser: url }`, and stops when stdin closes.
 * The browser's `/open?url=` signs the server's person in on its fake GitHub, follows the
 * redirects with cookies, then loads the loopback return the app is listening on.
 */
import { CookieJar, startAccounts } from "../../../accounts/src/testing/harness.ts";

const people = [
  {
    id: 583_231,
    login: "octocat",
    name: "The Octocat",
    emails: [
      { email: "octocat@lux.dev", primary: true, verified: true },
      { email: "octocat@work.example", primary: false, verified: true },
    ],
  },
  {
    id: 1001,
    login: "hubot",
    name: "Hubot",
    emails: [{ email: "hubot@acme.example", primary: true, verified: true }],
  },
] as const;

const servers = await Promise.all(people.map(() => startAccounts()));

const browser = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const target = new URL(request.url).searchParams.get("url") ?? "";
    const at = servers.findIndex((s) => target.startsWith(s.origin));
    const server = servers[at];
    const person = people[at];

    if (server === undefined || person === undefined)
      return new Response("unknown server", { status: 400 });
    server.github.signInAs(person);
    const { url } = await server.browse(target, new CookieJar());
    const loopback = await fetch(url);

    return new Response(await loopback.text(), { status: loopback.status });
  },
});

console.log(
  JSON.stringify({
    servers: servers.map((s) => s.origin),
    browser: `http://127.0.0.1:${browser.port}`,
  })
);

for await (const _ of Bun.stdin.stream()) {
  // Runs until the parent closes stdin.
}

await browser.stop(true);

await Promise.all(servers.map((s) => s.stop()));
