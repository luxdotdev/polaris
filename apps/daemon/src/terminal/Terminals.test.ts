import { afterEach, describe, expect, test } from "bun:test";
import type { TerminalId } from "@polaris/protocol";
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import { removeDir, tempDir } from "../git/testing.ts";
import {
  loginShell,
  Scrollback,
  type TerminalItem,
  Terminals,
  TerminalsLive,
} from "./Terminals.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let runtime: ManagedRuntime.ManagedRuntime<Terminals, never>;
const cleanup: Array<string> = [];
afterEach(async () => {
  await runtime?.dispose();
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const setup = () => {
  runtime = ManagedRuntime.make(Layer.fresh(TerminalsLive));
  const dir = tempDir("polaris-term-");
  cleanup.push(dir);
  const run = <A, E>(f: (t: Terminals["Service"]) => Effect.Effect<A, E>) =>
    runtime.runPromise(
      Effect.gen(function* () {
        return yield* f(yield* Terminals);
      })
    );
  /** Attaches and collects items into an array until the stream ends or is stopped. */
  const attach = (id: TerminalId) => {
    const items: Array<TerminalItem> = [];
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const terminals = yield* Terminals;
        yield* terminals
          .attach(id)
          .pipe(Stream.runForEach((item) => Effect.sync(() => items.push(item))));
      })
    );
    const text = () =>
      items.map((i) => (i._tag === "Output" ? decode(i.data) : `<exit ${i.code}>`)).join("");
    const waitFor = async (needle: string | RegExp, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const current = text();
        if (typeof needle === "string" ? current.includes(needle) : needle.test(current)) return;
        await Bun.sleep(20);
      }
      throw new Error(`timed out waiting for ${needle}; got ${JSON.stringify(text())}`);
    };
    return { items, fiber, text, waitFor, stop: () => runtime.runPromise(Fiber.interrupt(fiber)) };
  };
  return { dir, run, attach };
};

describe("Scrollback", () => {
  test("keeps the most recent bytes up to capacity", () => {
    const ring = new Scrollback(8);
    ring.push(encode("abc"));
    ring.push(encode("defg"));
    expect(decode(ring.snapshot())).toBe("abcdefg");
    ring.push(encode("hij"));
    expect(decode(ring.snapshot())).toBe("cdefghij");
    ring.push(encode("0123456789"));
    expect(decode(ring.snapshot())).toBe("23456789");
    expect(ring.byteLength).toBe(8);
  });
});

describe("Terminals", () => {
  test("echo round-trip, resize, and Exit with the process's code", async () => {
    const { dir, run, attach } = setup();
    const id = await run((t) => t.open({ cwd: dir, cols: 80, rows: 24, argv: ["/bin/sh"] }));
    const a = attach(id);
    await run((t) => t.input(id, encode("echo round-$((40+2))-trip; pwd\n")));
    await a.waitFor("round-42-trip");
    await a.waitFor(dir);

    await run((t) => t.resize(id, 100, 40));
    await run((t) => t.input(id, encode("stty size\n")));
    await a.waitFor("40 100");

    await run((t) => t.input(id, encode("exit 3\n")));
    await a.waitFor("<exit 3>");
    const exit = await runtime.runPromise(Fiber.await(a.fiber));
    expect(Exit.isSuccess(exit)).toBe(true);
    const list = await run((t) => t.list);
    expect(list.find((i) => i.id === id)?.exit).toEqual({ code: 3 });
  });

  test("late attachers get the scrollback replayed; many can attach at once", async () => {
    const { dir, run, attach } = setup();
    const id = await run((t) => t.open({ cwd: dir, cols: 80, rows: 24, argv: ["/bin/sh"] }));
    const first = attach(id);
    await run((t) => t.input(id, encode("echo before-late\n")));
    await first.waitFor(/before-late\r?\n/);

    // The first Client goes away; the terminal keeps running.
    await first.stop();
    const late = attach(id);
    await late.waitFor("before-late");
    const second = attach(id);
    await second.waitFor("before-late");
    await run((t) => t.input(id, encode("echo after-late\n")));
    await late.waitFor("after-late");
    await second.waitFor("after-late");
    await late.stop();
    await second.stop();
  });

  test("attaching after exit replays the output and the Exit", async () => {
    const { dir, run, attach } = setup();
    const id = await run((t) =>
      t.open({ cwd: dir, cols: 80, rows: 24, argv: ["/bin/sh", "-c", "echo done-now; exit 0"] })
    );
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const info = (await run((t) => t.list)).find((i) => i.id === id);
      if (info?.exit) break;
      await Bun.sleep(20);
    }
    const a = attach(id);
    await a.waitFor("done-now");
    await a.waitFor("<exit 0>");
  });

  test("close ends attachers and forgets the terminal", async () => {
    const { dir, run, attach } = setup();
    const id = await run((t) => t.open({ cwd: dir, cols: 80, rows: 24, argv: ["/bin/cat"] }));
    const a = attach(id);
    await run((t) => t.input(id, encode("ping\n")));
    await a.waitFor("ping");
    await run((t) => t.close(id));
    await a.waitFor("<exit null>");
    const error = await run((t) => Effect.flip(t.input(id, encode("x"))));
    expect(error).toMatchObject({ _tag: "NotFound", what: "terminal" });
  });

  test("a missing cwd is a FileError; an unknown id is NotFound", async () => {
    const { run } = setup();
    const error = await run((t) =>
      Effect.flip(t.open({ cwd: "/definitely/missing", cols: 80, rows: 24, argv: null }))
    );
    expect(error).toMatchObject({ _tag: "FileError", code: "ENOENT" });
    const missing = await run((t) => Effect.flip(t.resize("nope" as TerminalId, 1, 1)));
    expect(missing._tag).toBe("NotFound");
  });

  test("the default is the user's login shell", () => {
    expect(loginShell().startsWith("/")).toBe(true);
  });
});
