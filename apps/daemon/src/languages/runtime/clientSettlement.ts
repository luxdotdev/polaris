import { bounded } from "../transport/deadline.ts";
import type { Entry } from "./types.ts";

/** Keep teardown owned after disconnect without waiting on another Client's work. */
export class ClientSettlement {
  private readonly owners = new Map<string, Set<Promise<void>>>();

  track(clientId: string, operation: Promise<void>, retainFailure = false) {
    let owned = this.owners.get(clientId);

    if (owned === undefined) {
      owned = new Set();
      this.owners.set(clientId, owned);
    }

    const tasks = owned;

    tasks.add(operation);

    const release = () => {
      tasks.delete(operation);

      if (tasks.size === 0 && this.owners.get(clientId) === tasks) this.owners.delete(clientId);
    };

    void operation.then(release, () => {
      if (!retainFailure) release();
    });
  }

  wait(clientId: string, before: ReadonlyArray<Promise<unknown>>, deadlineMs = 10000) {
    const drain = async () => {
      await Promise.allSettled(before);

      for (;;) {
        const tasks = this.owners.get(clientId);

        if (tasks === undefined) return;
        await Promise.all(tasks);
      }
    };

    return bounded(drain(), deadlineMs);
  }
}

export class BrokerCleanup extends ClientSettlement {
  readonly all = new Set<Promise<void>>();

  readonly trackGlobal = (operation: Promise<void>, retainFailure = false, clientId?: string) => {
    this.all.add(operation);

    if (clientId !== undefined) this.track(clientId, operation, retainFailure);
    void operation.then(
      () => this.all.delete(operation),
      () => {
        if (!retainFailure) this.all.delete(operation);
      }
    );
  };
}

export function acquisitionTask(clientId: string) {
  let finish = () => {};

  const settlement = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return { clientId, cancelled: false, settlement, finish };
}

export type ClientAcquisition = ReturnType<typeof acquisitionTask>;

export function settleClientDisconnect(
  clientId: string,
  entries: Iterable<Entry>,
  acquisitions: Iterable<{ clientId: string; settlement: Promise<void> }>,
  disconnect: (clientId: string) => void,
  settlement: ClientSettlement
) {
  const work: Promise<unknown>[] = [];

  for (const acquisition of acquisitions)
    if (acquisition.clientId === clientId) work.push(acquisition.settlement);

  for (const entry of entries) {
    if (entry.identity.clientId !== clientId) continue;
    work.push(entry.tail);

    if (entry.starting !== undefined) work.push(entry.starting);
  }

  disconnect(clientId);

  return settlement.wait(clientId, work);
}
