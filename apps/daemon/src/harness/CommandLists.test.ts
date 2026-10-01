import { describe, expect, test } from "bun:test";
import { NotFound, SlashCommand } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { HarnessRegistry, ServiceError } from "../services.ts";
import { makeBenchDriver } from "./bench/BenchDriver.ts";
import { commandLists, STALE_MS } from "./CommandLists.ts";
import { HarnessError, type HarnessDriver } from "./HarnessDriver.ts";

const withDrivers = (drivers: ReadonlyArray<HarnessDriver>) =>
  Layer.succeed(
    HarnessRegistry,
    HarnessRegistry.of({
      get: (kind) => {
        const driver = drivers.find((d) => d.kind === kind);

        return driver
          ? Effect.succeed(driver)
          : Effect.fail(new ServiceError({ service: "harness", message: `no ${kind} driver` }));
      },
      all: Effect.succeed(drivers),
    })
  );

const handlerFor = (drivers: ReadonlyArray<HarnessDriver>) =>
  Effect.runSync(commandLists.pipe(Effect.provide(withDrivers(drivers))));

const command = (name: string) =>
  new SlashCommand({
    name,
    sigil: "/",
    description: "",
    argumentHint: null,
    kind: "command",
    source: "user",
    plugin: null,
    run: "text",
    action: null,
    template: null,
  });

/** A Codex driver whose listing counts calls, names its answer by call, and can fail once. */
const counting = () => {
  const cwds: Array<string> = [];
  const state = { calls: 0, failNext: false, cwds };

  const driver: HarnessDriver = {
    ...makeBenchDriver("codex"),
    listCommands: (cwd) =>
      Effect.suspend(() => {
        state.calls++;
        state.cwds.push(cwd);

        if (state.failNext) {
          state.failNext = false;

          return Effect.fail(new HarnessError({ harness: "codex", message: "signed out" }));
        }

        return Effect.succeed([command(`v${state.calls}`)]);
      }),
  };

  return { driver, state };
};

const names = (result: { readonly commands: ReadonlyArray<SlashCommand> }) =>
  result.commands.map((c) => c.name);

describe("harness.commands", () => {
  test("answers with the driver's list for the directory", async () => {
    const result = await Effect.runPromise(
      handlerFor([makeBenchDriver("codex")])({ harness: "codex", cwd: "/repo", refresh: false })
    );

    expect(result).toMatchObject({ harness: "codex", cwd: "/repo" });
    expect(result.commands.map((c) => [c.name, c.run])).toEqual([
      ["bench-skill", "text"],
      ["compact", "text"],
      ["model", "polaris"],
    ]);
  });

  test("an unknown Harness or one without a driver here is NotFound", async () => {
    const list = handlerFor([makeBenchDriver("codex")]);

    for (const harness of ["nope", "claude"]) {
      const error = await Effect.runPromise(
        list({ harness, cwd: "/repo", refresh: false }).pipe(Effect.flip)
      );

      expect(error).toBeInstanceOf(NotFound);
    }
  });

  test("a driver that lists nothing answers an empty list", async () => {
    const { listCommands: _none, ...silent } = makeBenchDriver("codex");

    const result = await Effect.runPromise(
      handlerFor([silent])({ harness: "codex", cwd: "/repo", refresh: false })
    );

    expect(result.commands).toEqual([]);
  });

  test("cached per directory; refresh reads again; a failure isn't cached", async () => {
    const { driver, state } = counting();
    const list = handlerFor([driver]);

    const ask = (cwd: string, refresh = false) =>
      Effect.runPromise(list({ harness: "codex", cwd, refresh }));

    state.failNext = true;

    const failed = await Effect.runPromise(
      list({ harness: "codex", cwd: "/a", refresh: false }).pipe(Effect.flip)
    );

    expect(failed).toMatchObject({ message: "signed out" });

    expect(names(await ask("/a"))).toEqual(["v2"]);
    expect(names(await ask("/a"))).toEqual(["v2"]);
    expect(names(await ask("/b"))).toEqual(["v3"]);
    expect(names(await ask("/a", true))).toEqual(["v4"]);
    expect(state.calls).toBe(4);
    expect(state.cwds).toEqual(["/a", "/a", "/b", "/a"]);
  });

  test("a stale answer is served while it is read again in the background, once", async () => {
    const { driver, state } = counting();
    const list = handlerFor([driver]);
    const ask = list({ harness: "codex", cwd: "/a", refresh: false }).pipe(Effect.map(names));

    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* ask;
        yield* TestClock.adjust(STALE_MS + 1);
        const stale = yield* ask;
        const again = yield* ask;
        yield* Effect.yieldNow;
        yield* Effect.promise(() => Bun.sleep(10));
        const fresh = yield* ask;

        return [first, stale, again, fresh];
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(seen).toEqual([["v1"], ["v1"], ["v1"], ["v2"]]);
    expect(state.calls).toBe(2);
  });
});
