import { Context, Effect, Layer, Schema } from "effect";
import { LanguageError } from "@polaris/protocol";
import {
  createInstaller,
  type InstallRequest,
  type InstallerOptions,
  type InstalledVersion,
  type Progress,
} from "./index.ts";

const installError = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "install-failed",
        message: "Managed installer failed",
        retryable: true,
      });

export class ManagedInstaller extends Context.Service<
  ManagedInstaller,
  {
    install: (request: InstallRequest) => Effect.Effect<InstalledVersion, LanguageError>;
    rollback: (
      request: Omit<InstallRequest, "intent">
    ) => Effect.Effect<InstalledVersion, LanguageError>;
    current: (toolId: string) => Effect.Effect<InstalledVersion | null, LanguageError>;
    progress: (toolId: string) => Effect.Effect<Progress | null>;
    subscribe: (listener: (progress: Progress) => void) => Effect.Effect<() => void, LanguageError>;
  }
>()("polaris/languages/ManagedInstaller") {
  static layer(options: InstallerOptions) {
    return Layer.effect(
      ManagedInstaller,
      Effect.acquireRelease(
        Effect.tryPromise({ try: () => createInstaller(options), catch: installError }),
        (installer) => Effect.promise(() => installer.dispose())
      ).pipe(
        Effect.map((installer) => {
          const perform = (start: () => ReturnType<typeof installer.install>) =>
            Effect.tryPromise({
              async try(signal) {
                const handle = start();
                const cancel = () => handle.cancel();
                signal.addEventListener("abort", cancel, { once: true });

                if (signal.aborted) cancel();

                try {
                  return await handle.result;
                } finally {
                  signal.removeEventListener("abort", cancel);
                }
              },
              catch: installError,
            });

          return ManagedInstaller.of({
            install: Effect.fn("ManagedInstaller.install")((request: InstallRequest) =>
              perform(() => installer.install(request))
            ),
            rollback: Effect.fn("ManagedInstaller.rollback")(
              (request: Omit<InstallRequest, "intent">) =>
                perform(() => installer.rollback(request))
            ),
            current: Effect.fn("ManagedInstaller.current")((toolId: string) =>
              Effect.tryPromise({ try: () => installer.current(toolId), catch: installError })
            ),
            progress: (toolId: string) => Effect.sync(() => installer.progress(toolId)),
            subscribe: (listener: (progress: Progress) => void) =>
              Effect.try({ try: () => installer.subscribe(listener), catch: installError }),
          });
        })
      )
    );
  }
}
