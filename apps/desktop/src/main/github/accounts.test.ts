import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { harness, memoryCrypto, signIn, until } from "./github.testing.ts";
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

describe("signing in with the device flow", () => {
  test("stores the account, with its tokens sealed", async () => {
    const h = open();
    const view = await h.run(signIn(h, "mona"));

    expect(view.accounts).toMatchObject([
      { id: 1001, login: "mona", state: "ok", missingScopes: [] },
    ]);
    expect(view.manageUrl).toBe(
      "https://github.test/settings/connections/applications/Ov23lix8h2ldBZFwXqek"
    );

    const sealed = readFileSync(join(h.dir, "tokens", "1001.bin"), "utf8");

    expect(sealed).not.toContain("gho_");
    expect(readFileSync(join(h.dir, "accounts.json"), "utf8")).not.toContain("gho_");
  });

  test("keeps polling while pending and slows down when told to", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;
        const started = yield* gh.startSignIn;

        yield* h.advance(5000);
        yield* h.advance(5000);
        h.fake.approveDevice(started.userCode, "hubot");
        yield* h.advance(5000);
        yield* until(gh.accounts, (v) => v.accounts.length === 1);
      })
    );

    const polls = h.fake.requests.filter((r) => r.name === "/login/oauth/access_token");

    expect(polls.length).toBe(3);
  });

  test("a slow_down answer adds five seconds before the next poll", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;
        const started = yield* gh.startSignIn;

        // Polling at 4.9 s is too fast for the fake: it says slow_down (interval 10).
        yield* h.advance(5000);
        h.fake.approveDevice(started.userCode, "mona");
        yield* h.advance(9000);
        yield* h.advance(1000);
        yield* until(gh.accounts, (v) => v.accounts.length === 1);
      })
    );

    expect(h.fake.requests.filter((r) => r.name === "/login/oauth/access_token").length).toBe(2);
  });

  test("a denied code fails the sign-in and stores nothing", async () => {
    const h = open();

    const view = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;
        const started = yield* gh.startSignIn;

        h.fake.denyDevice(started.userCode);
        yield* h.advance(5000);

        return yield* until(gh.accounts, (v) => v.signIn?.state === "failed");
      })
    );

    expect(view.signIn?.failure).toBe("denied");
    expect(view.accounts).toEqual([]);
  });

  test("is refused when tokens can't be stored safely", async () => {
    const h = open({ crypto: memoryCrypto(false) });
    const exit = await h.run(Effect.exit(GitHub.use((gh) => gh.startSignIn)));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(h.fake.requests).toEqual([]);
  });

  test("several accounts keep their order; removing one forgets its tokens", async () => {
    const h = open();

    const view = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        yield* signIn(h, "hubot");
        yield* gh.reorderAccounts([2002, 1001]);
        yield* gh.removeAccount(1001);

        return yield* until(gh.accounts, (v) => v.accounts.length === 1);
      })
    );

    expect(view.accounts.map((a) => a.login)).toEqual(["hubot"]);
    expect(readdirSync(join(h.dir, "tokens"))).toEqual(["2002.bin"]);
  });
});

describe("tokens", () => {
  test("a 401 refreshes once, even for calls made at the same time", async () => {
    const h = open();

    const titles = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        h.fake.expireAccessTokens();

        const pull = { repo: { owner: "acme", name: "widgets" }, number: 42 };
        const both = yield* Effect.all([gh.detail(pull), gh.detail(pull)], { concurrency: 2 });

        return both.map((d) => d.title);
      })
    );

    expect(titles).toEqual([
      "Retry webhook deliveries with backoff",
      "Retry webhook deliveries with backoff",
    ]);
    expect(h.fake.requests.filter((r) => r.name === "/login/oauth/access_token").length).toBe(2);
  });

  test("refreshes ahead of the 8-hour expiry", async () => {
    const h = open();

    await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        yield* h.advance(7.75 * 60 * 60 * 1000);
        yield* gh.detail({ repo: { owner: "acme", name: "widgets" }, number: 42 });
      })
    );

    const refreshes = h.fake.requests.filter((r) => r.name === "/login/oauth/access_token");
    const unauthorized = h.fake.requests.filter((r) => r.status === 401);

    expect(refreshes.length).toBe(2);
    expect(unauthorized).toEqual([]);
  });

  test("a revoked grant signs the account out instead of retrying", async () => {
    const h = open();

    const view = await h.run(
      Effect.gen(function* () {
        const gh = yield* GitHub;

        yield* signIn(h, "mona");
        h.fake.revoke("mona");
        yield* Effect.exit(gh.detail({ repo: { owner: "acme", name: "widgets" }, number: 42 }));

        return yield* until(gh.accounts, (v) => v.accounts[0]?.state === "signed-out");
      })
    );

    expect(view.accounts[0]?.login).toBe("mona");
  });

  test("survive a restart: a second app reads the sealed tokens", async () => {
    const first = open();

    await first.run(signIn(first, "mona"));

    const second = open({ dir: first.dir, sharedFake: first.fake });

    const detail = await second.run(
      GitHub.use((gh) => gh.detail({ repo: { owner: "acme", name: "widgets" }, number: 42 }))
    );

    expect(detail.number).toBe(42);
  });
});
