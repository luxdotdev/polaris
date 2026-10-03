import { LanguageError, type LanguageConnectionIdentity } from "@polaris/protocol";
import { Context, Effect, Exit, Layer } from "effect";

/** Request-local registration against the actual connection, never a payload identity. */
export class LanguageConnectionLifetime extends Context.Service<
  LanguageConnectionLifetime,
  {
    attach: (
      principal: LanguageConnectionIdentity,
      disconnect: () => Effect.Effect<void>
    ) => Effect.Effect<void, LanguageError>;
  }
>()("polaris/languages/LanguageConnectionLifetime") {
  static readonly unavailableLayer: Layer.Layer<LanguageConnectionLifetime> = Layer.succeed(
    LanguageConnectionLifetime
  )({
    attach: () => Effect.fail(unavailable()),
  });
}

const unavailable = () =>
  new LanguageError({
    reason: "not-connected",
    message: "Language connection lifetime is unavailable",
    retryable: false,
  });

/** One owner per actual transport connection; close seals registrations before awaiting cleanup. */
export class ConnectionLanguageLifetime {
  private readonly callbacks = new Set<() => Effect.Effect<void>>();
  private closed = false;

  constructor(private readonly current: () => LanguageConnectionIdentity | null) {}

  readonly attach: LanguageConnectionLifetime["Service"]["attach"] = (principal, callback) =>
    Effect.suspend(() => {
      if (this.closed || this.current() !== principal) return Effect.fail(unavailable());

      if (!this.callbacks.has(callback) && this.callbacks.size >= 1024)
        return Effect.fail(unavailable());

      this.callbacks.add(callback);

      return Effect.void;
    });

  readonly seal = () => {
    this.closed = true;
  };

  readonly close = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      this.seal();

      const callbacks = [...this.callbacks];

      this.callbacks.clear();

      return Effect.forEach(
        callbacks,
        (callback) =>
          Effect.suspend(callback).pipe(
            Effect.exit,
            Effect.flatMap((exit) =>
              Exit.isFailure(exit)
                ? Effect.logWarning("Language disconnect cleanup failed")
                : Effect.void
            )
          ),
        { discard: true }
      );
    });
}
