import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_CATALOGUE } from "@polaris/protocol";
import { Deferred, Effect, Fiber, type Scope, Stream } from "effect";
import { RpcTest } from "effect/rpc";
import { Availability } from "./Availability.ts";
import { AvailabilityRpcs, AvailabilityRpcsLive } from "./AvailabilityRpcs.ts";

const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A Host with a fake `codex` whose sign-in the test flips; `claude` isn't installed. */
const fakeHost = () => {
  const root = mkdtempSync(join(tmpdir(), "polaris-availability-rpc-"));
  dirs.push(root);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const counter = join(root, "probes");
  mkdirSync(join(home, ".codex"), { recursive: true });
  mkdirSync(bin);
  const signedIn = join(root, "signed-in");

  writeFileSync(
    join(bin, "codex"),
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo x >> "${counter}"; echo 'codex-cli 0.158.0'; exit 0; fi
if [ -e "${signedIn}" ]; then exit 0; fi
echo 'Not logged in' >&2; exit 1
`
  );
  chmodSync(join(bin, "codex"), 0o755);

  return {
    env: { HOME: home, PATH: bin },
    signIn: () => writeFileSync(signedIn, ""),
    probes: async () =>
      (await Bun.file(counter).exists()) ? (await Bun.file(counter).text()).length / 2 : 0,
  };
};

const statuses = (report: { harnesses: ReadonlyArray<{ harness: string; status: string }> }) =>
  Object.fromEntries(report.harnesses.map((h) => [h.harness, h.status]));

/** Runs `body` against the handlers, on a Host with `env`. */
const run = <A, E>(
  env: Record<string, string>,
  body: Effect.Effect<A, E, Scope.Scope | Availability>
) =>
  Effect.runPromise(
    Effect.scoped(body).pipe(Effect.provide(Availability.layer({ env, bench: false })))
  );

const client = RpcTest.makeClient(AvailabilityRpcs).pipe(Effect.provide(AvailabilityRpcsLive));

describe("harness.availability", () => {
  test("probes once, answers from the cache, probes again on refresh", async () => {
    const host = fakeHost();

    const [first, second, refreshed] = await run(
      host.env,
      Effect.gen(function* () {
        const rpc = yield* client;
        const first = yield* rpc["harness.availability"]({ refresh: false });
        const second = yield* rpc["harness.availability"]({ refresh: false });
        host.signIn();
        const refreshed = yield* rpc["harness.availability"]({ refresh: true });

        return [first, second, refreshed] as const;
      })
    );

    expect(first.harnesses.map((h) => h.harness)).toEqual(HARNESS_CATALOGUE.map((h) => h.kind));
    expect(statuses(first)).toEqual({
      claude: "not-installed",
      codex: "needs-sign-in",
      gemini: "not-installed",
      copilot: "not-installed",
    });
    expect(second).toEqual(first);
    expect(statuses(refreshed)).toMatchObject({ claude: "not-installed", codex: "ready" });
    expect(await host.probes()).toBe(2);
  });

  test("concurrent asks share one probe", async () => {
    const host = fakeHost();

    await run(
      host.env,
      Effect.flatMap(client, (rpc) =>
        Effect.all(
          Array.from({ length: 5 }, () => rpc["harness.availability"]({ refresh: false })),
          { concurrency: "unbounded" }
        )
      )
    );

    expect(await host.probes()).toBe(1);
  });

  test("watch sends the current report, then each refresh", async () => {
    const host = fakeHost();

    const reports = await run(
      host.env,
      Effect.gen(function* () {
        const rpc = yield* client;
        const first = yield* Deferred.make<void>();

        const watching = yield* rpc["harness.watchAvailability"]({}).pipe(
          Stream.tap(() => Deferred.succeed(first, undefined)),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild
        );

        yield* Deferred.await(first);
        host.signIn();
        yield* rpc["harness.availability"]({ refresh: true });

        return yield* Fiber.join(watching);
      })
    );

    expect(reports.map((r) => statuses(r).codex)).toEqual(["needs-sign-in", "ready"]);
  });

  test("the bench Daemon reports every Harness ready without probing", async () => {
    const report = await Effect.runPromise(
      Effect.flatMap(Availability, (availability) => availability.get(false)).pipe(
        Effect.provide(Availability.layer({ env: { PATH: "" }, bench: true }))
      )
    );

    expect(new Set(report.harnesses.map((h) => h.status))).toEqual(new Set(["ready"]));
  });
});
