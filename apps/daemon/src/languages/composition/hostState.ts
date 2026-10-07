import { LanguageError, type HostId, type LanguageConnectionIdentity } from "@polaris/protocol";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import type { HostInstallation } from "../install/host.ts";
import type { HostStateInput } from "../install/hostState.ts";
import { LanguageConnectionLifetime } from "../../transport/languageConnectionLifetime.ts";
import { languageOperation } from "../runtime/service.ts";
import { requestAuthority } from "./authority.ts";

const streamError = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "not-ready",
        message: "Host language state is unavailable",
        retryable: true,
      });

function makeHostStateCore(hostId: HostId, host: HostInstallation) {
  const bindings = new WeakMap<
    LanguageConnectionIdentity,
    {
      controller: AbortController;
      close: () => Effect.Effect<void>;
    }
  >();

  const authority = Effect.gen(function* () {
    const auth = yield* requestAuthority(hostId);
    const lifetime = yield* LanguageConnectionLifetime;
    let binding = bindings.get(auth.principal);

    if (binding === undefined) {
      const controller = new AbortController();
      binding = { controller, close: () => Effect.sync(() => controller.abort()) };
      bindings.set(auth.principal, binding);
    }

    yield* lifetime.attach(auth.principal, binding.close);
    yield* auth.check;

    return { auth, signal: binding.controller.signal };
  });

  return {
    read: Effect.fn("LanguageHostState.read")(function* (input: HostStateInput) {
      const current = yield* authority;

      const state = yield* languageOperation((signal) =>
        host.hostState.read(input, AbortSignal.any([signal, current.signal]))
      );

      yield* current.auth.check;

      return state;
    }),
    watch: (input: HostStateInput) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const current = yield* authority;

          const watched = yield* Effect.acquireRelease(
            languageOperation((signal) =>
              host.hostState.watch(input, AbortSignal.any([signal, current.signal]))
            ),
            (iterator) =>
              Effect.promise(async () => {
                await iterator.return?.();
              })
          );

          yield* current.auth.check;

          return Stream.fromAsyncIterable(watched, streamError).pipe(
            Stream.mapEffect((state) => Effect.as(current.auth.check, state))
          );
        })
      ),
  };
}

export class LanguageHostStateCore extends Context.Service<
  LanguageHostStateCore,
  ReturnType<typeof makeHostStateCore>
>()("polaris/languages/LanguageHostStateCore") {
  static layer(hostId: HostId, host: HostInstallation) {
    return Layer.succeed(LanguageHostStateCore)(makeHostStateCore(hostId, host));
  }
}
