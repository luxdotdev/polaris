import type { LiveSession } from "@polaris/client";
import { HostSessionDefaults } from "@polaris/protocol";
import { Effect, Schema, Stream } from "effect";

/** One atomic import per Host; an existing Host choice always wins over the Client's legacy file. */
export const migrateSessionDefaults = (
  rpc: Pick<LiveSession["client"], "settings.set">,
  legacy: HostSessionDefaults
) => rpc["settings.set"]({ key: "sessions.defaults", value: legacy, ifUnset: true });

export const loadSessionDefaults = (rpc: Pick<LiveSession["client"], "settings.get">) =>
  rpc["settings.get"]({ key: "sessions.defaults" }).pipe(
    Effect.map((entry) => Schema.decodeUnknownSync(HostSessionDefaults)(entry.value))
  );

/** Each live connection imports then reads its Host; reconnects refresh values changed elsewhere. */
export const followSessionDefaults = (
  sessions: Stream.Stream<LiveSession | null>,
  legacy: HostSessionDefaults,
  publish: (defaults: HostSessionDefaults) => void
) =>
  sessions.pipe(
    Stream.runForEach((session) =>
      session === null || !session.capabilities.includes("settings")
        ? Effect.void
        : Effect.gen(function* () {
            yield* migrateSessionDefaults(session.client, legacy);
            const defaults = yield* loadSessionDefaults(session.client);
            publish(defaults);
          }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not load host session defaults", error)
            )
          )
    )
  );
