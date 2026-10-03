import { Context, Effect, Layer, Schema } from "effect";
import { LanguageError, type LanguageAvailability } from "@polaris/protocol";
import type { ObservationAdmission, HostInstallation, RequestGuard } from "../install/host.ts";
import type { InstalledVersion, Progress, InstallHandle } from "../install/index.ts";

const normalize = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "install-failed",
        message: "Host language tooling could not be checked",
        retryable: true,
      });

export class HostLanguageInstallation extends Context.Service<
  HostLanguageInstallation,
  {
    inspect: (
      toolId: string,
      phase: "install" | "feature",
      trusted: boolean,
      admission?: ObservationAdmission
    ) => Effect.Effect<LanguageAvailability, LanguageError>;
    install: (
      toolId: string,
      intent: "encounter" | "install" | "update",
      guard: RequestGuard,
      admission?: ObservationAdmission
    ) => Effect.Effect<InstalledVersion, LanguageError>;
    rollback: (
      toolId: string,
      identity: string,
      guard: RequestGuard,
      admission?: ObservationAdmission
    ) => Effect.Effect<InstalledVersion, LanguageError>;
    current: (toolId: string) => Effect.Effect<InstalledVersion | null, LanguageError>;
    subscribe: (listener: (progress: Progress) => void) => Effect.Effect<() => void, LanguageError>;
  }
>()("polaris/languages/HostLanguageInstallation") {
  /** Registry owns disposal; H1 binds one immutable Host instance into its Daemon scope. */
  static layer(host: HostInstallation) {
    const perform = (start: (signal: AbortSignal) => Promise<InstallHandle>) =>
      Effect.tryPromise({
        async try(signal) {
          const handle = await start(signal);

          return handle.result;
        },
        catch: normalize,
      });

    return Layer.succeed(
      HostLanguageInstallation,
      HostLanguageInstallation.of({
        inspect: Effect.fn("HostLanguageInstallation.inspect")(
          (
            toolId: string,
            phase: "install" | "feature",
            trusted: boolean,
            admission?: ObservationAdmission
          ) =>
            Effect.tryPromise({
              try: (signal) => host.inspect(toolId, phase, trusted, admission, signal),
              catch: normalize,
            })
        ),
        install: Effect.fn("HostLanguageInstallation.install")(
          (
            toolId: string,
            intent: "encounter" | "install" | "update",
            guard: RequestGuard,
            admission?: ObservationAdmission
          ) => perform((signal) => host.install(toolId, intent, guard, signal, admission))
        ),
        rollback: Effect.fn("HostLanguageInstallation.rollback")(
          (
            toolId: string,
            identity: string,
            guard: RequestGuard,
            admission?: ObservationAdmission
          ) => perform((signal) => host.rollback(toolId, identity, guard, signal, admission))
        ),
        current: Effect.fn("HostLanguageInstallation.current")((toolId: string) =>
          Effect.tryPromise({ try: () => host.current(toolId), catch: normalize })
        ),
        subscribe: (listener: (progress: Progress) => void) =>
          Effect.try({ try: () => host.subscribe(listener), catch: normalize }),
      })
    );
  }
}
