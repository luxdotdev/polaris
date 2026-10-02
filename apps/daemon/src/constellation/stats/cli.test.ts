import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConstellationStats } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { CID } from "../../engine/constellation.testing.ts";
import { seedStats } from "./store.testing.ts";

test("the real CLI reads Stats over RPC from an isolated Daemon and emits decodable JSON", async () => {
  const home = mkdtempSync("/tmp/polaris-stats-cli-");
  const main = resolve(import.meta.dir, "../../main.ts");

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, "codex"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    POLARIS_HOME: home,
    POLARIS_HOST_SOCKET: join(home, "daemon.sock"),
    POLARIS_BENCH_HARNESS: "1",
    POLARIS_SESSION_ID: undefined,
    POLARIS_BINARY: undefined,
  };

  await Effect.runPromise(
    seedStats.pipe(Effect.provide(EventStore.layerSqlite(join(home, "state.sqlite"))))
  );

  const daemon = Bun.spawn([process.execPath, main, "serve", "--foreground"], {
    env,
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    for (let i = 0; i < 200 && !existsSync(join(home, "daemon.sock")); i++) await Bun.sleep(20);
    expect(existsSync(join(home, "daemon.sock"))).toBe(true);

    const child = Bun.spawn([process.execPath, main, "constellation", "stats", "c1", "--json"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(errors).toBe("");
    const stats = Schema.decodeUnknownSync(Schema.fromJsonString(ConstellationStats))(output);
    expect(stats.constellationId).toBe(CID);
    expect(stats.lead.wakeups).toBe(2);
    expect(stats.usage.total.tokens.input).toBe(0);
    expect(stats.workers.attempts).toHaveLength(2);
    expect(output).toContain('"api-equivalent-estimate"');
    expect(output).toContain('"staleMs": null');
    expect(existsSync(join(home, "usage.sqlite"))).toBe(true);
  } finally {
    daemon.kill("SIGTERM");
    await daemon.exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
