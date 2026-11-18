/**
 * A Teammate's connection (ADR 0112): how a refused statement reads as a Connection State,
 * and renewing the statement on a live connection before it lapses.
 */
import { STATEMENT_LIFETIME_S, type StatementRejected } from "@polaris/protocol";
import { Duration, Effect, type Redacted, Schedule } from "effect";
import { ConnectFailure } from "./failures.ts";

/** Renewed at two thirds of its life, so one failed renewal still has time to be retried. */
export const STATEMENT_RENEW_MS = Math.floor((STATEMENT_LIFETIME_S * 1000 * 2) / 3);

/** No Share left needs the user; anything else is retried like a lost link. */
export const statementFailure = (error: StatementRejected): ConnectFailure =>
  error.reason === "no-share"
    ? new ConnectFailure({ kind: "needs-attention", reason: "share-ended", detail: error.message })
    : new ConnectFailure({
        kind: "transient",
        reason: "connection-failed",
        detail: `${error.message} (${error.reason})`,
      });

/**
 * Presents a fresh statement every `STATEMENT_RENEW_MS` for as long as the connection lives.
 * A failed renewal is left alone: the Host closes the connection when the statement lapses,
 * and the next attempt fetches a new one.
 */
export const renewStatement = <E>(
  statement: Effect.Effect<Redacted.Redacted<string>, ConnectFailure>,
  refresh: (statement: Redacted.Redacted<string>) => Effect.Effect<unknown, E>
): Effect.Effect<void> =>
  Effect.ignore(Effect.flatMap(statement, refresh)).pipe(
    Effect.delay(Duration.millis(STATEMENT_RENEW_MS)),
    Effect.repeat(Schedule.forever),
    Effect.asVoid
  );
