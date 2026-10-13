import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect } from "effect";
import { armShutdownGrace, deadline, exitStuck } from "../deadline.ts";

// `startup` parks forever before listening; `shutdown` listens, then parks its stop.
const mode = process.argv[2];

const parked = Effect.uninterruptible(Effect.never);

if (mode === "startup") {
  const startup = deadline("starting", { ms: 300, onExpire: exitStuck("startup") });
  startup.phase("recovering Constellations");
  BunRuntime.runMain(parked);
} else {
  armShutdownGrace(300);
  BunRuntime.runMain(
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => parked);
      process.stdout.write("ready\n");

      return yield* Effect.never;
    }).pipe(Effect.scoped)
  );
}
