import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Exit, SubscriptionRef } from "effect";
import { FAKE_GHE_CLIENT_ID } from "../../../scripts/lib/githubFake/index.ts";
import { GHE_HOST, harness, until } from "./github.testing.ts";
import { GitHub } from "./index.ts";

const harnesses: Array<ReturnType<typeof harness>> = [];

const open = () => {
  const h = harness();

  harnesses.push(h);

  return h;
};

afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup();
});

interface Case {
  readonly name: string;
  readonly host: string | undefined;
  readonly login: string;
  readonly setup: Effect.Effect<void, never, GitHub>;
}

const HOSTS: Array<Case> = [
  { name: "github.com", host: undefined, login: "mona", setup: Effect.void },
  {
    name: "GitHub Enterprise",
    host: GHE_HOST,
    login: "mona-ent",
    setup: GitHub.use((gh) => gh.addHost({ host: GHE_HOST, clientId: FAKE_GHE_CLIENT_ID })).pipe(
      Effect.asVoid,
      Effect.orDie
    ),
  },
];

const polls = (h: ReturnType<typeof harness>) =>
  [...h.fake.requests, ...h.ghe.requests].filter((r) => r.name === "/login/oauth/access_token");

describe.each(HOSTS)(
  "signing in to $name when GitHub can't be reached",
  ({ host, login, setup }) => {
    test.each([
      ["net::ERR_PROXY_CONNECTION_FAILED", "network"],
      ["net::ERR_CERT_AUTHORITY_INVALID", "certificate"],
    ])("a device code request failing with %s shows %s on the card", async (cause, failure) => {
      const h = open();

      const { exit, view } = await h.run(
        Effect.gen(function* () {
          const gh = yield* GitHub;

          yield* setup;
          h.network.down = new Error(cause);

          const exit = yield* Effect.exit(gh.startSignIn(host));

          return { exit, view: yield* until(gh.accounts, (v) => v.signIn !== null) };
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(view.signIn).toMatchObject({
        host: host ?? "github.com",
        state: "failed",
        failure,
        detail: cause,
        userCode: null,
      });
    });

    test("a dropped network during polling retries three times, then fails with the reason", async () => {
      const h = open();

      const states = await h.run(
        Effect.gen(function* () {
          const gh = yield* GitHub;

          yield* setup;
          yield* gh.startSignIn(host);
          h.network.down = new Error("net::ERR_INTERNET_DISCONNECTED");

          const seen: Array<string | undefined> = [];

          // The first poll, then retries after 10, 20 and 30 s: the fourth miss ends it.
          for (const ms of [5000, 10_000, 20_000]) {
            yield* h.advance(ms);
            seen.push((yield* SubscriptionRef.get(gh.accounts)).signIn?.state);
          }

          yield* h.advance(30_000);

          const failed = yield* until(gh.accounts, (v) => v.signIn?.state === "failed");

          return { seen, failed: failed.signIn };
        })
      );

      expect(states.seen).toEqual(["waiting", "waiting", "waiting"]);
      expect(states.failed).toMatchObject({
        failure: "network",
        detail: "net::ERR_INTERNET_DISCONNECTED",
      });
    });

    test("a network that comes back within the retries still signs in", async () => {
      const h = open();

      const view = await h.run(
        Effect.gen(function* () {
          const gh = yield* GitHub;

          yield* setup;
          const started = yield* gh.startSignIn(host);

          h.network.down = new Error("net::ERR_NETWORK_CHANGED");
          yield* h.advance(5000);
          yield* h.advance(10_000);
          h.network.down = null;
          (host === GHE_HOST ? h.ghe : h.fake).approveDevice(started.userCode, login);
          yield* h.advance(20_000);

          return yield* until(gh.accounts, (v) => v.signIn === null && v.accounts.length === 1);
        })
      );

      expect(view.accounts.map((a) => a.login)).toEqual([login]);
    });
  }
);

test("GitHub's own authorization_pending keeps waiting past the transport retry limit", async () => {
  const h = open();

  const view = await h.run(
    Effect.gen(function* () {
      const gh = yield* GitHub;

      yield* gh.startSignIn();

      for (let i = 0; i < 6; i++) yield* h.advance(5000);

      return yield* SubscriptionRef.get(gh.accounts);
    })
  );

  expect(polls(h).length).toBe(6);
  expect(view.signIn?.state).toBe("waiting");
});
