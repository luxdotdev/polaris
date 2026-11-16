/** `userAccess.*` (ADR 0114): the registry of enrolled Desktop Apps, as each connection sees it. */
import { NotFound, UserAccessRpcs } from "@polaris/protocol";
import { Effect, Option, Queue, Stream } from "effect";
import type { DefaultOptions } from "./shared.ts";

const missing = (what: string, id: string) => Effect.fail(new NotFound({ what, id }));

export const userAccessDefaults = ({ userAccess }: DefaultOptions) =>
  UserAccessRpcs.toLayer({
    // Sliding by one: a burst of changes reads the state once more, never once per change.
    "userAccess.watch": (_, { client }) =>
      Stream.callback<void>(
        (queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              Queue.offerUnsafe(queue, undefined);

              return userAccess.watch(() => Queue.offerUnsafe(queue, undefined));
            }),
            (stop) => Effect.sync(stop)
          ),
        { bufferSize: 1, strategy: "sliding" }
      ).pipe(
        Stream.map(() => userAccess.stateFor(client)),
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b))
      ),
    "userAccess.allow": ({ id }) =>
      Effect.sync(() => userAccess.allow(id)).pipe(
        Effect.flatMap(
          Option.match({ onNone: () => missing("request", id), onSome: Effect.succeed })
        )
      ),
    "userAccess.deny": ({ id }) =>
      Effect.sync(() => userAccess.deny(id)).pipe(
        Effect.flatMap((denied) => (denied ? Effect.void : missing("request", id)))
      ),
    "userAccess.revoke": ({ id }) =>
      Effect.sync(() => userAccess.revoke(id)).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => missing("enrolled desktop app", id),
            onSome: Effect.succeed,
          })
        )
      ),
  });
