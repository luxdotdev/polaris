import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { LOST_EXIT_CODE, leaseExit } from "./cli.ts";
import { guardExit, processGone } from "./lostExit.ts";

/** A child whose exit Bun never reports: its stdout closes, `exit` never comes. */
const silentChild = (pid = 42) => {
  const child = Object.assign(new EventEmitter(), { pid, stdout: new EventEmitter() });
  const exits: unknown[][] = [];
  child.on("exit", (...args: unknown[]) => exits.push(args));

  return { child, exits };
};

const gone = (answer: boolean) => {
  const asked: number[] = [];

  return { asked, gone: async (pid: number) => asked.push(pid) > 0 && answer };
};

describe("a child whose exit is lost", () => {
  test("exits once it's gone after closing its stdout", async () => {
    const { child, exits } = silentChild();
    guardExit(child, { intervalMs: 5, gone: gone(true).gone });

    child.stdout.emit("close");
    await Bun.sleep(50);

    expect(exits).toEqual([[null, null]]);
  });

  test("a running child is never checked", async () => {
    const { child, exits } = silentChild();
    const check = gone(true);
    guardExit(child, { intervalMs: 5, gone: check.gone });

    await Bun.sleep(50);

    expect(check.asked).toEqual([]);
    expect(exits).toEqual([]);
  });

  test("a reported exit stops the check, so exit isn't repeated", async () => {
    const { child, exits } = silentChild();
    guardExit(child, { intervalMs: 20, gone: gone(true).gone });

    child.stdout.emit("close");
    child.emit("exit", 0, null);
    await Bun.sleep(80);

    expect(exits).toEqual([[0, null]]);
  });

  test("a lease's command that is gone without an exit ends the wrapper", async () => {
    const lost = leaseExit({ pid: 42, exited: new Promise(() => {}) }, "identity", {
      intervalMs: 5,
      gone: gone(true).gone,
    });

    expect(await lost).toBe(LOST_EXIT_CODE);
  });

  test("a lease's command keeps its own exit code while it runs and exits", async () => {
    const check = gone(false);

    const code = await leaseExit({ pid: 42, exited: Bun.sleep(30).then(() => 7) }, "identity", {
      intervalMs: 5,
      gone: check.gone,
    });

    expect(code).toBe(7);
    expect(check.asked.length).toBeGreaterThan(0);
  });
});

describe.skipIf(process.platform === "win32")("whether a process is gone", () => {
  test("an exited child is gone; this process is not", async () => {
    const child = Bun.spawn(["/bin/sh", "-c", "exit 0"]);
    await child.exited;

    expect(await processGone(child.pid)).toBe(true);
    expect(await processGone(process.pid)).toBe(false);
  });

  test("a reused PID is gone: its start time differs", async () => {
    expect(await processGone(process.pid, "Thu Jan  1 00:00:00 1970")).toBe(true);
  });
});
