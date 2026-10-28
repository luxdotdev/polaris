/** The screen's view of the verdict outbox: each row's delivery, sending, and retry on reconnect. */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useLiveHost } from "../runtime/hosts.tsx";
import type { SendVerdict } from "./claim.tsx";
import type { TaskRow } from "./model.ts";
import { type Delivery, deliveryKey, hostSteps, verdictOutbox } from "./outbox.ts";

export interface Verdicts {
  readonly find: (row: TaskRow) => Delivery | null;
  readonly send: (row: TaskRow) => SendVerdict;
  readonly cancel: (row: TaskRow) => void;
}

export const useVerdicts = (connection: HostConnection, constellationId: string): Verdicts => {
  // Re-renders the screen as deliveries move; rows read them through find.
  useSyncExternalStore(verdictOutbox.subscribe, verdictOutbox.version);
  const live = useLiveHost(connection);
  const steps = useMemo(() => hostSteps(connection), [connection]);

  useEffect(() => {
    if (live !== null) verdictOutbox.retryLost(steps, constellationId);
  }, [live, steps, constellationId]);

  return useMemo(() => {
    const find = (row: TaskRow) => verdictOutbox.find(constellationId, row.id, row.handed);

    return {
      find,
      send:
        ({ id, handed }) =>
        (verdict, reply) => {
          const pending = verdictOutbox.find(constellationId, id, handed);
          // Once the claim leaves the user, its delivery holds the claim it was for.
          const claim = handed ?? pending?.input;

          if (claim === undefined) return;
          void verdictOutbox.submit(steps, {
            verdict,
            constellationId,
            taskId: id,
            attemptId: claim.attemptId,
            revision: claim.revision,
            head: claim.head,
            reply,
          });
        },
      cancel: (row) => {
        const d = find(row);

        if (d !== null) verdictOutbox.cancel(deliveryKey(d.input));
      },
    };
  }, [constellationId, steps]);
};
