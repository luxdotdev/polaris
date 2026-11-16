import { Deferred, Duration, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { shareDevices } from "../invites/index.ts";
import { findPerson } from "../people/index.ts";
import { ShareChanges } from "../server/services.ts";
import { signStatement } from "../statements/index.ts";

/** The longest a devices request waits for a change (the contract's 60 s). */
export const MAX_WAIT_S = 60;

/** The ETag rolls over this often, so a waiting Host gets fresh statements well inside 15 min. */
export const STATEMENT_REFRESH_MS = 5 * 60 * 1000;

/** How often a waiting request rereads, for changes made on another instance. */
const RECHECK_MS = 5000;

const etagOf = (version: number, now: number) =>
  `"${version}.${Math.floor(now / STATEMENT_REFRESH_MS)}"`;

const waitSeconds = (url: string) => {
  const raw = new URL(url, "http://local").searchParams.get("wait");
  const parsed = raw === null ? MAX_WAIT_S : Number(raw);

  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), MAX_WAIT_S) : MAX_WAIT_S;
};

const fullResponse = Effect.fn(function* (inviteId: string, etag: string) {
  const { inviteeId, devices } = yield* shareDevices(inviteId);

  const person =
    devices.length === 0 || inviteeId === undefined ? undefined : yield* findPerson(inviteeId);

  const body =
    person === undefined
      ? []
      : yield* Effect.forEach(devices, (device) =>
          Effect.map(signStatement(person, device.noiseKey), (statement) => ({
            personId: person.id,
            relayAddress: device.relayAddress,
            noiseKey: device.noiseKey,
            statement,
          }))
        );

  return HttpServerResponse.jsonUnsafe(body, { headers: { etag, "cache-control": "no-store" } });
});

/**
 * `GET /v1/shares/{inviteId}/devices`: with `If-None-Match` set to the current ETag it waits up to
 * `wait` seconds (default and most 60) for a change, then answers 304.
 */
export const devicesResponse = Effect.fn("devicesResponse")(function* (inviteId: string) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const changes = yield* ShareChanges;
  const ifNoneMatch = request.headers["if-none-match"];
  const deadline = Date.now() + waitSeconds(request.url) * 1000;

  while (true) {
    const signal = yield* changes.next(inviteId);
    const now = Date.now();
    const { version } = yield* shareDevices(inviteId);
    const etag = etagOf(version, now);

    if (etag !== ifNoneMatch) return yield* fullResponse(inviteId, etag);
    const untilRefresh = STATEMENT_REFRESH_MS - (now % STATEMENT_REFRESH_MS);
    const remaining = Math.min(deadline - now, RECHECK_MS, untilRefresh);

    if (deadline - now <= 0) return HttpServerResponse.empty({ status: 304, headers: { etag } });
    yield* Deferred.await(signal).pipe(Effect.timeoutOption(Duration.millis(remaining)));
  }
}, Effect.orDie);
