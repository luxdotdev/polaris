import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { harness, type Network, signIn, until } from "./github.testing.ts";
import { GitHub } from "./index.ts";

const harnesses: Array<ReturnType<typeof harness>> = [];

const open = (options: Parameters<typeof harness>[0] = {}) => {
  const h = harness(options);

  harnesses.push(h);

  return h;
};

afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup();
});

const PULL = { repo: { owner: "acme", name: "widgets" }, number: 42 };

const DAY_MS = 24 * 60 * 60 * 1000;

const unreachable: ReadonlyArray<[string, (network: Network) => void]> = [
  ["no network", (n) => void (n.down = new Error("net::ERR_INTERNET_DISCONNECTED"))],
  [
    "a captive portal's page",
    (n) =>
      void (n.answer = () =>
        new Response("<html>Accept the terms to continue</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })),
  ],
  ["a 503", (n) => void (n.answer = () => new Response("unavailable", { status: 503 }))],
];

const refreshes = (h: ReturnType<typeof harness>) =>
  h.fake.requests.filter((r) => r.name === "/login/oauth/access_token").length;

describe("a refresh that can't reach GitHub", () => {
  test.each(unreachable)(
    "%s leaves the account signed in, and the next call once GitHub answers refreshes",
    async (_name, cut) => {
      const h = open();

      const result = await h.run(
        Effect.gen(function* () {
          const gh = yield* GitHub;

          yield* signIn(h, "mona");
          cut(h.network);
          yield* h.advance(DAY_MS);

          const offline = yield* Effect.exit(gh.detail(PULL));
          const during = yield* until(gh.accounts, () => true);

          h.network.down = null;
          h.network.answer = null;

          const detail = yield* gh.detail(PULL);

          return { offline, during, detail };
        })
      );

      expect(Exit.isFailure(result.offline)).toBe(true);
      expect(result.during.accounts[0]?.state).toBe("ok");
      expect(result.detail.number).toBe(42);
    }
  );
});

describe("a signed-out account whose refresh token still works", () => {
  test("comes back on the next poll, without the device flow", async () => {
    const first = open();

    await first.run(signIn(first, "mona"));

    // An account signed out by a refresh that never reached GitHub, as before ENG-372.
    const path = join(first.dir, "accounts.json");

    writeFileSync(
      path,
      readFileSync(path, "utf8").replace('"signedOut": false', '"signedOut": true')
    );

    const second = open({ dir: first.dir, sharedFake: first.fake });

    const view = await second.run(
      GitHub.use((gh) => until(gh.accounts, (v) => v.accounts[0]?.state === "ok"))
    );

    expect(view.accounts.map((a) => a.login)).toEqual(["mona"]);
  });

  test("one GitHub refuses is signed out with its tokens dropped, and not tried again", async () => {
    const h = open();

    const tried = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        h.fake.revoke("mona");
        yield* Effect.exit(gh.detail(PULL));
        yield* until(gh.accounts, (v) => v.accounts[0]?.state === "signed-out");

        const before = refreshes(h);

        yield* h.advance(DAY_MS);

        return refreshes(h) - before;
      })
    );

    expect(existsSync(h.tokenPath(1001))).toBe(false);
    expect(tried).toBe(0);
  });
});
