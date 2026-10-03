import type { Constellation, HostId } from "@polaris/protocol";
import { Effect } from "effect";
import type { ConnectionStatus } from "../HostConnection.ts";

interface Observer<E> {
  readonly epoch: number;
  readonly observe: (input: { hostId: HostId; offline: boolean }) => Effect.Effect<void, E>;
}

/** Replays observed Offline/Connected facts after owner reconnect; no polling or inferred timeout. */
export const connectionObservations = () => {
  const facts = new Map<HostId, { offline: boolean; epoch: number }>();
  const sent = new Map<string, string>();

  return {
    observe: (status: ConnectionStatus) => {
      if (status.host !== null && (status.state === "offline" || status.state === "connected"))
        facts.set(status.host.hostId, { offline: status.state === "offline", epoch: status.epoch });
    },
    publish: Effect.fnUntraced(function* <E>(
      graphs: Iterable<Constellation>,
      byId: (id: HostId) => Observer<E> | undefined
    ) {
      for (const graph of graphs) {
        const owner = byId(graph.hostId);

        if (owner === undefined) continue;

        for (const hostId of new Set(graph.attempts.map((a) => a.hostId))) {
          if (hostId === graph.hostId) continue;
          const fact = facts.get(hostId);
          const offline = fact?.offline;
          const key = JSON.stringify([graph.hostId, graph.id, hostId]);

          const observation = JSON.stringify([
            owner.epoch,
            fact?.epoch,
            offline,
            graph.attempts.filter((a) => a.hostId === hostId).map((a) => a.id),
          ]);

          if (offline === undefined || sent.get(key) === observation) continue;
          yield* owner.observe({ hostId, offline }).pipe(
            Effect.tap(() => Effect.sync(() => sent.set(key, observation))),
            Effect.catch(() => Effect.void)
          );
        }
      }
    }),
  };
};
