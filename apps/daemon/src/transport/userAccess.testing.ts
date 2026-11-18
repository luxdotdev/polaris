import { Effect, Predicate, Redacted } from "effect";

/** A test Desktop App's user key: a fresh root enrols it on its first `hello` (ADR 0114). */
export const TEST_USER_KEY = { userKey: Redacted.make("0".repeat(64)) } as const;

/** The request's own error: the user gate must have let it through. */
export const ownError = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, { readonly _tag: "UserAccessRequired" }> =>
        Predicate.isTagged(error, "UserAccessRequired"),
      (error) => Effect.die(error)
    ),
    Effect.flip
  );
