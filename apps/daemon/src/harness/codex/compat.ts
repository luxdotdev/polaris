/**
 * Older app-servers (the catalogue's `minVersion` up to its `testedVersion`).
 * They ignore params fields they don't know (no `deny_unknown_fields`: the
 * generated JSON schemas allow extra properties), but refuse an enum value
 * they don't know with JSON-RPC "invalid params". Then the request is sent
 * once more without the newer optional fields, which turns those features off
 * rather than failing the session or its Turn.
 */
import { Effect, Predicate } from "effect";
import type { HarnessError } from "../HarnessDriver.ts";
import type * as P from "./protocol.ts";
import type { RpcConnection } from "./RpcConnection.ts";

/** JSON-RPC 2.0's code for params the server couldn't read. */
const INVALID_PARAMS = -32602;

export const isInvalidParams = (error: HarnessError): boolean =>
  Predicate.hasProperty(error.cause, "code") && error.cause.code === INVALID_PARAMS;

/**
 * `method` with `params`; on "invalid params", with `older` instead (the same
 * request without its newer optional fields).
 */
export const requestCompat = (
  conn: RpcConnection,
  method: string,
  params: P.Outgoing,
  older: P.Outgoing
): Effect.Effect<P.RpcPayload, HarnessError> =>
  conn
    .request(method, params)
    .pipe(
      Effect.catch((error) =>
        isInvalidParams(error)
          ? Effect.logWarning(`codex ${method}: retrying without newer fields`, error.message).pipe(
              Effect.andThen(conn.request(method, older))
            )
          : Effect.fail(error)
      )
    );
