/**
 * Unlink on the phone (RX1-3): each Host revokes this iPhone's key over its own session
 * before the Keychain forgets it. A Host that doesn't answer keeps trusting the key.
 */
import { Effect } from "effect";
import type { HostConnection } from "../runtime/hostConnection.ts";

/** How long Unlink waits for each Host to revoke this iPhone. */
export const REVOKE_WAIT_MS = 5_000;

export type RevokingHost = Pick<HostConnection, "hostId" | "run">;

/** The ids of the Hosts that revoked this device; the rest still accept its key. */
export const revokeOnHosts = async (
  hosts: ReadonlyArray<RevokingHost>,
  waitMs = REVOKE_WAIT_MS
): Promise<ReadonlySet<string>> => {
  const answers = await Promise.all(
    hosts.map((host) =>
      Promise.race([
        host
          .run((client) => Effect.asVoid(client["devices.unlinkSelf"]()))
          .then(
            () => host.hostId,
            () => null
          ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
      ])
    )
  );

  return new Set(answers.flatMap((id) => (id === null ? [] : [id])));
};
