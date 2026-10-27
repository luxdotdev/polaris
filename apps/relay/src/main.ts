#!/usr/bin/env bun
/** The Polaris Relay process: reads its config, serves until SIGTERM, then closes every socket. */
import { BunRuntime } from "@effect/platform-bun";
import { Cause, Context, Effect, Exit, Layer, Runtime } from "effect";
import { relayConfig } from "./config.ts";
import { type RelayHandle, startRelay } from "./server.ts";
import { stdoutWideEvents } from "./wideEvent.ts";

export class Relay extends Context.Service<Relay, RelayHandle>()("polaris/relay/Relay") {
  static readonly layer = Layer.effect(
    Relay,
    Effect.gen(function* () {
      const config = yield* relayConfig;

      return yield* Effect.acquireRelease(
        Effect.sync(() => startRelay(config, stdoutWideEvents)),
        (relay) => Effect.promise(relay.stop)
      );
    })
  );
}

/** SIGTERM is how a container platform stops the relay, so a clean shutdown exits 0. */
const teardown: Runtime.Teardown = (exit, onExit) =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
    ? onExit(0)
    : Runtime.defaultTeardown(exit, onExit);

if (import.meta.main) BunRuntime.runMain(Layer.launch(Relay.layer), { teardown });
