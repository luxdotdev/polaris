import {
  LanguageContextIdentity,
  LanguageError,
  type HostId,
  type LanguageCheckout,
} from "@polaris/protocol";
import { realpathSync } from "node:fs";
import { Effect, Schema } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { CurrentLanguageConnection } from "../../transport/currentLanguageConnection.ts";
import { registeredCheckout } from "../registeredCheckout.ts";
import { canonicalCheckout, checkoutKey } from "../trust/index.ts";

export const denied = () =>
  new LanguageError({
    reason: "not-owner",
    message: "Language request is not owned by the current connection",
    retryable: false,
  });

const failure = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "invalid-input",
        message: "Registered checkout is unavailable",
        retryable: false,
      });

/** The live getter and folded registry are looked up inside each request, never from payload identity. */
export const requestAuthority = (hostId: HostId) =>
  Effect.gen(function* () {
    const connection = yield* CurrentLanguageConnection;
    const store = yield* EventStore;
    const principal = connection.current();

    if (principal === null || principal.hostId !== hostId) return yield* Effect.fail(denied());

    const check = Effect.try({
      try: () => {
        if (connection.current() !== principal) throw denied();
      },
      catch: failure,
    });

    const checkout = (input: LanguageCheckout) =>
      Effect.gen(function* () {
        yield* check;

        const canonical = yield* Effect.tryPromise({
          try: async (signal) =>
            canonicalCheckout(async (value) => {
              const model = await Effect.runPromise(store.model, { signal });

              if (connection.current() !== principal) throw denied();

              return registeredCheckout(model, value);
            }, input),
          catch: failure,
        });

        yield* check;
        const currentModel = yield* store.model;
        yield* check;
        yield* Effect.try({
          try: () => {
            const current = registeredCheckout(currentModel, input);

            if (
              checkoutKey(current.checkout) !== checkoutKey(canonical.checkout) ||
              realpathSync(current.checkout.path) !== canonical.root ||
              realpathSync(input.path) !== canonical.root ||
              realpathSync(current.workspacePath) !== canonical.workspaceRoot
            )
              throw denied();
          },
          catch: failure,
        });
        yield* check;

        return canonical;
      });

    const coordinates = (input: LanguageContextIdentity) =>
      Effect.try({
        try: () => {
          const context = Schema.decodeUnknownSync(LanguageContextIdentity)(input);

          if (context.hostId !== principal.hostId || context.clientId !== principal.clientId)
            throw denied();
        },
        catch: failure,
      });

    return {
      principal,
      check,
      checkout,
      coordinates,
      lost: () => connection.current() !== principal,
      supports: (capability: import("@polaris/protocol").Capability) =>
        connection.current() === principal && connection.supports?.(capability) === true,
    };
  });

export type RequestAuthority = Effect.Success<ReturnType<typeof requestAuthority>>;
