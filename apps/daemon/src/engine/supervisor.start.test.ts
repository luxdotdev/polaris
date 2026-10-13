import { describe, expect, test } from "bun:test";
import { Effect, Logger } from "effect";
import { timedStart } from "./supervisor.start.ts";

const logged = async <A, E>(effect: Effect.Effect<A, E>) => {
  const logs: Array<string> = [];
  const logger = Logger.make((entry) => void logs.push(Logger.formatSimple.log(entry)));
  await Effect.runPromise(Effect.exit(effect.pipe(Effect.provide(Logger.layer([logger])))));

  return logs;
};

describe("timedStart", () => {
  test("logs the open and how long it took, at info, for the session", async () => {
    const logs = await logged(timedStart(Effect.succeed(1), "claude", "1 second", "pi", "s-1"));

    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("session s-1: opening Claude Code");
    expect(logs[1]).toMatch(/session s-1: Claude Code opened in \d+ ms/);
    expect(logs.every((line) => line.includes("level=INFO"))).toBe(true);
  });

  test("a start that never reports back logs why it failed", async () => {
    const logs = await logged(timedStart(Effect.never, "codex", "20 millis", "pi", "s-2"));

    expect(logs.at(-1)).toContain("session s-2: Codex failed to open: Codex didn't start on pi");
  });

  test("a crash in the open logs its message", async () => {
    const logs = await logged(
      timedStart(Effect.die(new Error("boom")), "claude", "1 second", "pi", "s-3")
    );

    expect(logs.at(-1)).toContain(
      "Claude Code failed to open: Claude Code couldn't start on pi: boom"
    );
  });
});
