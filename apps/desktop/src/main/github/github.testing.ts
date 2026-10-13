/**
 * Test harness: the GitHub service on the in-process fake, a throwaway userData
 * directory, `SecureStorage` on a test sealer and a TestClock the fake shares.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import {
  createGitHubEnterpriseFake,
  createGitHubFake,
  type GitHubFake,
  type GitHubFakeOptions,
} from "../../../scripts/lib/githubFake/index.ts";
import { type BudgetPolicy, DEFAULT_POLICY } from "./budget.ts";
import { type Sealer, SecureStorage } from "../secure/index.ts";
import { testSealer } from "../secure/secure.testing.ts";
import { GitHub } from "./index.ts";
import { legacyTokens } from "./store.ts";

/** The fake GitHub Enterprise Server: `https://ghe.acme.test/api/v3`, `/api/graphql`. */
export const GHE_HOST = "ghe.acme.test";

export interface HarnessOptions {
  readonly fake?: GitHubFakeOptions;
  readonly policy?: BudgetPolicy;
  readonly sealer?: Sealer;
  /** `<userData>/github`; tokens live under `<userData>/secure`, as in the app. */
  readonly dir?: string;
  /** Another harness's fake: a second app on the same GitHub. */
  readonly sharedFake?: GitHubFake;
  readonly mutationGapMs?: number;
}

export const harness = (options: HarnessOptions = {}) => {
  let now = 0;
  const fake = options.sharedFake ?? createGitHubFake({ now: () => now, ...options.fake });
  const ghe = createGitHubEnterpriseFake({ now: () => now });
  const dir = options.dir ?? join(mkdtempSync(join(tmpdir(), "polaris-github-")), "github");
  const userData = dirname(dir);

  mkdirSync(dir, { recursive: true });

  const storage = SecureStorage.files({
    dir: join(userData, "secure"),
    sealer: options.sealer ?? testSealer(),
    adopt: [legacyTokens(userData)],
  });

  const layer = GitHub.layer({
    dir,
    // github.com's fake at github.test, GHE's at its own host with GHES paths.
    fetch: (url, init) =>
      new URL(url).host === GHE_HOST ? ghe.fetch(url, init) : fake.fetch(url, init),
    endpoints: { web: "https://github.test", api: "https://api.github.test" },
    now: () => now,
    policy: options.policy ?? DEFAULT_POLICY,
    mutationGapMs: options.mutationGapMs ?? 0,
  }).pipe(Layer.provide(storage), Layer.provideMerge(TestClock.layer({ warningDelay: "1 hour" })));

  /** Moves the TestClock and the fake's clock together. */
  const advance = (ms: number) =>
    Effect.andThen(
      Effect.sync(() => {
        now += ms;
      }),
      TestClock.adjust(ms)
    );

  const run = <A, E>(effect: Effect.Effect<A, E, GitHub>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.scoped));

  return {
    fake,
    ghe,
    dir,
    /** Where `SecureStorage` keeps an account's sealed tokens. */
    tokenPath: (id: number) => join(userData, "secure", "github", "tokens", `${id}.bin`),
    advance,
    run,
    cleanup: () => rmSync(userData, { recursive: true, force: true }),
  };
};

/** Waits (on fibers, not time) until `ref` holds a value `holds` accepts. */
export const until = <A>(ref: SubscriptionRef.SubscriptionRef<A>, holds: (value: A) => boolean) =>
  SubscriptionRef.changes(ref).pipe(
    Stream.filter(holds),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption)
  );

/** Signs `login` in through the device flow on the fake (the GHE fake for `host`). */
export const signIn = (h: ReturnType<typeof harness>, login: string, host?: string) =>
  Effect.gen(function* () {
    const gh = yield* GitHub;
    const started = yield* gh.startSignIn(host);

    (host === GHE_HOST ? h.ghe : h.fake).approveDevice(started.userCode, login);
    yield* h.advance(5000);

    return yield* until(
      gh.accounts,
      (v) => v.signIn === null && v.accounts.some((a) => a.login === login)
    );
  });
