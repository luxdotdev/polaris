import { LanguageError, type HostId, type LanguageConnectionIdentity } from "@polaris/protocol";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import type { HostInstallation } from "../install/host.ts";
import {
  createInstallOwnership,
  type InstallAction,
  type InstallOwnerPort,
  type OwnedInstallRequest,
} from "../install/ownership.ts";
import { LanguageConnectionLifetime } from "../../transport/languageConnectionLifetime.ts";
import { requestAuthority } from "./authority.ts";
import { languageOperation } from "../runtime/service.ts";

const permissionUnavailable = () =>
  new LanguageError({
    reason: "unsupported-capability",
    message: "Independent installation permission is unavailable",
    retryable: false,
  });

/** Action grants are independent of execution trust and artifact approval. */
export class LanguageInstallGrantAuthority extends Context.Service<
  LanguageInstallGrantAuthority,
  {
    authorize: (
      principal: LanguageConnectionIdentity,
      action: InstallAction
    ) => Effect.Effect<void, LanguageError>;
  }
>()("polaris/languages/LanguageInstallGrantAuthority") {
  static readonly denyLayer = Layer.succeed(LanguageInstallGrantAuthority)({
    authorize: () => Effect.fail(permissionUnavailable()),
  });
}

interface InstallBindingState {
  port: InstallOwnerPort | undefined;
}

interface InstallInput {
  toolId: string;
  version: string;
  intent: "first-encounter" | "manual" | "update" | "rollback";
}

const intents: Record<InstallInput["intent"], OwnedInstallRequest["intent"]> = {
  "first-encounter": "encounter",
  manual: "install",
  update: "update",
  rollback: "rollback",
};

const streamError = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "install-failed",
        message: "Installation progress is unavailable",
        retryable: false,
      });

function makeInstallCore(
  hostId: HostId,
  host: HostInstallation,
  ownership: ReturnType<typeof createInstallOwnership>,
  grants: LanguageInstallGrantAuthority["Service"]
) {
  const bindings = new WeakMap<
    LanguageConnectionIdentity,
    { port: InstallOwnerPort; close: () => Effect.Effect<void> }
  >();

  const owner = Effect.gen(function* () {
    const auth = yield* requestAuthority(hostId);
    const lifetime = yield* LanguageConnectionLifetime;
    const previous = bindings.get(auth.principal);

    if (previous !== undefined) {
      yield* lifetime.attach(auth.principal, previous.close);
      yield* auth.check;

      return previous.port;
    }

    const controller = new AbortController();
    const state: InstallBindingState = { port: undefined };

    const close = () =>
      Effect.gen(function* () {
        controller.abort();

        const retained = state.port;

        if (retained !== undefined) yield* Effect.promise(() => retained.dispose());
      });

    yield* lifetime.attach(auth.principal, close);
    yield* auth.check;

    const port = yield* Effect.try({
      try: () =>
        ownership.bind({
          principal: auth.principal,
          lifetime: controller.signal,
          requireCurrent: (signal) => Effect.runPromise(auth.check, { signal }),
          authorize: (action, signal) =>
            Effect.runPromise(grants.authorize(auth.principal, action), { signal }),
        }),
      catch: streamError,
    });

    state.port = port;
    bindings.set(auth.principal, { port, close });

    return port;
  });

  return {
    start: (input: InstallInput) =>
      Effect.gen(function* () {
        const port = yield* owner;

        if (input.intent === "rollback") {
          const auth = yield* requestAuthority(hostId);

          yield* grants.authorize(auth.principal, {
            operation: "install",
            request: { toolId: input.toolId, version: input.version, intent: "rollback" },
          });
          yield* auth.check;
        }

        return yield* languageOperation(async (signal) => {
          let retainedIdentity: string | undefined;

          if (input.intent === "rollback") {
            const matches = (await host.versions(input.toolId)).filter(
              (version) => version.version === input.version
            );

            if (matches.length !== 1)
              throw new LanguageError({
                reason: "conflict",
                message: "Rollback requires one exact retained version identity",
                retryable: false,
              });
            retainedIdentity = matches[0]?.identity;
          }

          const request: OwnedInstallRequest = {
            toolId: input.toolId,
            version: input.version,
            intent: intents[input.intent],
          };

          const exact = retainedIdentity === undefined ? request : { ...request, retainedIdentity };

          return port.start(exact, undefined, signal);
        });
      }),
    cancel: (jobId: string) =>
      Effect.flatMap(owner, (port) => languageOperation((signal) => port.cancel(jobId, signal))),
    watch: (jobId: string) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const port = yield* owner;

          const watched = yield* Effect.acquireRelease(
            languageOperation((signal) => port.watch(jobId, signal)),
            (value) => Effect.promise(() => value.dispose())
          );

          return Stream.fromAsyncIterable(watched.updates, streamError);
        })
      ),
  };
}

/** Consumers close before the supplied Host's outer registry finalizer. */
export class LanguageInstallCore extends Context.Service<
  LanguageInstallCore,
  ReturnType<typeof makeInstallCore>
>()("polaris/languages/LanguageInstallCore") {
  static layer(hostId: HostId, host: HostInstallation) {
    return Layer.effect(
      LanguageInstallCore,
      Effect.gen(function* () {
        const grants = yield* LanguageInstallGrantAuthority;

        const ownership = yield* Effect.acquireRelease(
          Effect.sync(() => createInstallOwnership(host)),
          (value) => Effect.promise(() => value.dispose())
        );

        return LanguageInstallCore.of(makeInstallCore(hostId, host, ownership, grants));
      })
    );
  }
}
