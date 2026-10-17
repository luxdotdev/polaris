import { Cause, Effect } from "effect";

/**
 * Logs a request's defect, with its whole cause, at error level. The RpcServer then
 * fails only that request with it (`disableFatalDefects`, ADR 0064).
 */
export const logDefects = <A, E, R>(
  tag: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.tapCause(effect, (cause) =>
    Cause.hasDies(cause) ? Effect.logError(`RPC ${tag} died`, cause) : Effect.void
  );
