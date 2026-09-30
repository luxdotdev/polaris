import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { makeBenchDriver } from "./bench/BenchDriver.ts";
import { makeClaudeDriver } from "./claude/ClaudeDriver.ts";
import { makeCodexDriver } from "./codex/CodexDriver.ts";
import type { HarnessDriver } from "./HarnessDriver.ts";
import { makeOpenCodeDriver } from "./opencode/OpenCodeDriver.ts";
import { DRIVER_CAPABILITIES, lazyDriver } from "./registry.ts";

describe("lazyDriver", () => {
  test("loads the real driver once, on first probe, not when built", async () => {
    let loads = 0;

    const real: HarnessDriver = {
      kind: "codex",
      capabilities: DRIVER_CAPABILITIES.codex,
      probe: Effect.succeed({ available: true, version: "1.2.3", detail: null }),
      open: () => Effect.die("unused"),
    };

    const driver = await Effect.runPromise(
      lazyDriver(
        "codex",
        DRIVER_CAPABILITIES.codex,
        Effect.sync(() => {
          loads++;

          return real;
        })
      )
    );

    expect(loads).toBe(0);
    expect(driver.capabilities).toEqual(real.capabilities);
    expect((await Effect.runPromise(driver.probe)).version).toBe("1.2.3");
    await Effect.runPromise(driver.probe);
    expect(loads).toBe(1);
  });

  test("declared capabilities match the drivers they stand in for", async () => {
    const dir = mkdtempSync(join(tmpdir(), "polaris-registry-"));

    try {
      const codex = await Effect.runPromise(
        Effect.scoped(
          makeCodexDriver({
            codexPath: null,
            socketPath: join(dir, "codex.sock"),
            spawnAppServer: false,
          })
        )
      );

      expect(codex.capabilities).toEqual(DRIVER_CAPABILITIES.codex);

      const opencode = await Effect.runPromise(
        Effect.scoped(makeOpenCodeDriver({ opencodePath: () => null, stateDir: dir }))
      );

      expect(opencode.capabilities).toEqual(DRIVER_CAPABILITIES.opencode);
      expect(makeClaudeDriver().capabilities).toEqual(DRIVER_CAPABILITIES.claude);
      expect(makeBenchDriver("claude").capabilities).toEqual(DRIVER_CAPABILITIES.bench);
      expect(makeBenchDriver("codex").capabilities).toEqual(DRIVER_CAPABILITIES.bench);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
