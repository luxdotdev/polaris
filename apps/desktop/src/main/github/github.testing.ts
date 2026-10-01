/**
 * Test harness: the GitHub service on the in-process fake, a throwaway userData
 * directory, an in-memory keychain and a TestClock the fake shares.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import {
  createGitHubFake,
  type GitHubFake,
  type GitHubFakeOptions,
} from "../../../scripts/lib/githubFake/index.ts";
import { type BudgetPolicy, DEFAULT_POLICY } from "./budget.ts";
import { GitHub } from "./index.ts";
import type { Crypto } from "./store.ts";

/** Seals with base64 behind a prefix: enough to prove no token is written in the clear. */
export const memoryCrypto = (available = true): Crypto => ({
  available: () => Promise.resolve(available),
  encrypt: (plain) =>
    Promise.resolve(new TextEncoder().encode(`sealed:${Buffer.from(plain).toString("base64")}`)),
  decrypt: (sealed) => {
    const text = new TextDecoder().decode(sealed).replace(/^sealed:/, "");

    return Promise.resolve({
      text: Buffer.from(text, "base64").toString("utf8"),
      shouldReEncrypt: false,
    });
  },
});

export interface HarnessOptions {
  readonly fake?: GitHubFakeOptions;
  readonly policy?: BudgetPolicy;
  readonly crypto?: Crypto;
  readonly dir?: string;
  /** Another harness's fake: a second app on the same GitHub. */
  readonly sharedFake?: GitHubFake;
  readonly mutationGapMs?: number;
}

export const harness = (options: HarnessOptions = {}) => {
  let now = 0;
  const fake = options.sharedFake ?? createGitHubFake({ now: () => now, ...options.fake });
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "polaris-github-"));

  const layer = GitHub.layer({
    dir,
    crypto: options.crypto ?? memoryCrypto(),
    fetch: fake.fetch,
    endpoints: { web: "https://github.test", api: "https://api.github.test" },
    now: () => now,
    policy: options.policy ?? DEFAULT_POLICY,
    mutationGapMs: options.mutationGapMs ?? 0,
  }).pipe(Layer.provideMerge(TestClock.layer({ warningDelay: "1 hour" })));

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

  return { fake, dir, advance, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

/** Waits (on fibers, not time) until `ref` holds a value `holds` accepts. */
export const until = <A>(ref: SubscriptionRef.SubscriptionRef<A>, holds: (value: A) => boolean) =>
  SubscriptionRef.changes(ref).pipe(
    Stream.filter(holds),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption)
  );

/** Signs `login` in through the device flow on the fake. */
export const signIn = (h: ReturnType<typeof harness>, login: string) =>
  Effect.gen(function* () {
    const gh = yield* GitHub;
    const started = yield* gh.startSignIn;

    h.fake.approveDevice(started.userCode, login);
    yield* h.advance(5000);

    return yield* until(
      gh.accounts,
      (v) => v.signIn === null && v.accounts.some((a) => a.login === login)
    );
  });
