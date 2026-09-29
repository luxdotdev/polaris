import { describe, expect, test } from "bun:test";
import { HARNESS_CATALOGUE, HarnessUnavailable, NotFound } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { HarnessRegistry, ServiceError } from "../services.ts";
import { makeBenchDriver } from "./bench/BenchDriver.ts";
import type { HarnessDriver } from "./HarnessDriver.ts";
import { handleListModels } from "./HarnessRpcs.ts";
import { DRIVER_CAPABILITIES, lazyDriver } from "./registry.ts";

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

/** The error `harness.models` answers with. */
const failure = (harness: string, drivers: ReadonlyArray<HarnessDriver>) =>
  Effect.runPromise(
    handleListModels({ harness, refresh: false }).pipe(
      Effect.provide(withDrivers(drivers)),
      Effect.flip
    )
  );

describe("harness.models", () => {
  test("answers with the driver's Models and whether it switches mid-session", async () => {
    const result = await Effect.runPromise(
      handleListModels({ harness: "codex", refresh: false }).pipe(
        Effect.provide(withDrivers([makeBenchDriver("codex")]))
      )
    );

    expect(result.harness).toBe("codex");
    expect(result.switchesModel).toBe(true);
    expect(result.models.map((m) => [m.id, m.isDefault, m.efforts])).toEqual([
      ["bench-large", true, ["low", "medium", "high"]],
      ["bench-small", false, []],
    ]);
  });

  test("a Harness outside the catalogue, or without a driver here, is NotFound", async () => {
    for (const harness of ["opencode", "claude"]) {
      expect(await failure(harness, [makeBenchDriver("codex")])).toBeInstanceOf(NotFound);
    }
  });

  test("a driver that can't list its Models yet makes the Harness unavailable", async () => {
    const driver = await Effect.runPromise(
      lazyDriver(
        "codex",
        DRIVER_CAPABILITIES.codex,
        Effect.sync(() => {
          const { listModels: _unlisted, ...unlisted } = makeBenchDriver("codex");

          return unlisted;
        })
      )
    );

    const error = await failure("codex", [driver]);
    expect(error).toBeInstanceOf(HarnessUnavailable);
    expect(error).toMatchObject({ harness: "codex" });
  });

  test("every catalogue entry has declared driver capabilities", () => {
    expect(Object.keys(DRIVER_CAPABILITIES).sort()).toEqual(
      [...HARNESS_CATALOGUE.map((h) => h.kind), "bench"].sort()
    );
  });
});
