/**
 * Opens `count` terminals whose command prints and exits at once, 32 at a
 * time, and waits for each Exit; prints `done <count>`. A deadlocked spawn
 * freezes this process, so the test runs it as a child with a deadline.
 *
 *   bun fast-exits.ts <count> <dir>
 */
import { Effect, Stream } from "effect";
import { Terminals, TerminalsLive } from "../Terminals.ts";

const count = Number(process.argv[2] ?? 200);

const cwd = process.argv[3] ?? "/tmp";

const program = Effect.gen(function* () {
  const terminals = yield* Terminals;

  const one = Effect.gen(function* () {
    const id = yield* terminals.open({
      cwd,
      cols: 80,
      rows: 24,
      argv: ["/bin/sh", "-c", "echo done-now; exit 0"],
    });

    yield* Stream.runDrain(terminals.attach(id));
    yield* terminals.close(id);
  });

  yield* Effect.forEach(Array.from({ length: count }), () => one, { concurrency: 32 });
});

await Effect.runPromise(program.pipe(Effect.provide(TerminalsLive)));

console.log(`done ${count}`);

process.exit(0);
