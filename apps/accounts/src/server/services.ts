import { Context, Deferred, Effect, Schema } from "effect";
import type { Auth } from "../auth/index.ts";
import type { AccountsConfig } from "../config.ts";
import type { Database } from "../db/index.ts";

/** The running server's config, database and Better Auth instance. */
export class Accounts extends Context.Service<
  Accounts,
  { readonly config: AccountsConfig; readonly db: Database; readonly auth: Auth }
>()("@polaris/accounts/Accounts") {}

export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  cause: Schema.Defect(),
}) {}

/** Runs a database or Better Auth call; a failure is a {@link StoreError}. */
export const store = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new StoreError({ cause }) });

/**
 * Wakes long-polls when a Share's devices change. In-process only: a long-poll on another
 * instance sees the change at its next recheck.
 */
export class ShareChanges extends Context.Service<
  ShareChanges,
  {
    /** The signal for the next change to `inviteId`; take it before reading, then await it. */
    readonly next: (inviteId: string) => Effect.Effect<Deferred.Deferred<void>>;
    readonly changed: (inviteId: string) => Effect.Effect<void>;
  }
>()("@polaris/accounts/ShareChanges") {
  static readonly make = (): ShareChanges["Service"] => {
    const waiting = new Map<string, Deferred.Deferred<void>>();

    return {
      next: (inviteId) =>
        Effect.sync(() => {
          const existing = waiting.get(inviteId);

          if (existing !== undefined) return existing;
          const created = Deferred.makeUnsafe<void>();
          waiting.set(inviteId, created);

          return created;
        }),
      changed: (inviteId) =>
        Effect.suspend(() => {
          const signal = waiting.get(inviteId);
          waiting.delete(inviteId);

          return signal === undefined
            ? Effect.void
            : Deferred.succeed(signal, undefined).pipe(Effect.asVoid);
        }),
    };
  };
}
