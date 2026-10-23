/** Admission happens before RpcServer allocates a handler fiber or streaming Ack latch. */
export const EXTENSION_RPC_LIMITS = { perConnection: 32, total: 128 } as const;

interface Reservation {
  active: boolean;
  terminal: boolean;
}

export const rpcAdmissionBudget = (limits = EXTENSION_RPC_LIMITS) => {
  const pending = new Map<number, Map<string | number, Reservation>>();
  let total = 0;

  const settle = (clientId: number, requestId: string | number) => {
    const requests = pending.get(clientId);
    const request = requests?.get(requestId);

    if (request === undefined || request.active || !request.terminal) return;
    requests!.delete(requestId);
    total--;

    if (requests!.size === 0) pending.delete(clientId);
  };

  return {
    acquire(clientId: number, requestId: string | number): boolean {
      const requests = pending.get(clientId);

      if (
        requests?.has(requestId) ||
        (requests?.size ?? 0) >= limits.perConnection ||
        total >= limits.total
      )
        return false;

      const owned = requests ?? new Map<string | number, Reservation>();
      owned.set(requestId, { active: false, terminal: false });
      pending.set(clientId, owned);
      total++;

      return true;
    },
    start(clientId: number, requestId: string | number): void {
      const request = pending.get(clientId)?.get(requestId);

      if (request !== undefined) request.active = true;
    },
    finish(clientId: number, requestId: string | number): void {
      const request = pending.get(clientId)?.get(requestId);

      if (request !== undefined) request.active = false;
      settle(clientId, requestId);
    },
    terminal(clientId: number, requestId: string | number): void {
      const request = pending.get(clientId)?.get(requestId);

      if (request !== undefined) request.terminal = true;
      settle(clientId, requestId);
    },
    disconnect(clientId: number): void {
      for (const requestId of pending.get(clientId)?.keys() ?? []) {
        this.terminal(clientId, requestId);
      }
    },
  };
};
