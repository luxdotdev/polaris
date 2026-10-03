import type { SelectionReservation, RequestGuard } from "./host.ts";
import { checkAbort, failure } from "./validation.ts";

export interface LaunchReservation {
  readonly identity: string;
  readonly validate: RequestGuard;
  readonly assertCurrent: () => void;
  /** Release only after the generation failed before spawn or all owned children have been cleaned. */
  readonly release: () => Promise<void>;
}

/** Host-local admission. Compose both ports from the same instance; no timers or session-state invention. */
export function createSelectionLedger() {
  const selections = new Map<string, symbol>();
  const launches = new Map<string, Map<symbol, string>>();
  let count = 0;
  let disposed = false;

  const current = (signal: AbortSignal) => {
    checkAbort(signal);

    if (disposed) throw failure("cancelled", "Tool selection ledger is disposed");
  };

  return {
    async reserveSelection(toolId: string, signal: AbortSignal): Promise<SelectionReservation> {
      current(signal);

      if (selections.has(toolId) || launches.has(toolId))
        throw failure("conflict", "Tool version is in use by a language-server session", true);

      if (selections.size >= 4)
        throw failure("queue-full", "Tool selection reservation limit reached", true);
      const token = Symbol(toolId);
      selections.set(toolId, token);

      return {
        validate: async (next) => {
          current(next);

          if (selections.get(toolId) !== token)
            throw failure("conflict", "Tool selection reservation is no longer current", true);
        },
        release: async () => {
          if (selections.get(toolId) === token) selections.delete(toolId);
        },
      };
    },
    async reserveLaunch(
      toolId: string,
      identity: string,
      signal: AbortSignal
    ): Promise<LaunchReservation> {
      current(signal);

      if (!/^sha256:[a-f0-9]{64}$/.test(identity))
        throw failure("invalid-input", "Invalid installed tool identity");

      if (selections.has(toolId))
        throw failure("conflict", "Tool version selection is pending", true);

      if (count >= 64)
        throw failure("queue-full", "Language-server reservation limit reached", true);
      const token = Symbol(toolId);
      const active = launches.get(toolId) ?? new Map<symbol, string>();

      if ([...active.values()].some((value) => value !== identity))
        throw failure(
          "conflict",
          "Another installed version still has language-server sessions",
          true
        );
      active.set(token, identity);
      launches.set(toolId, active);
      count++;

      const assertCurrent = () => {
        if (disposed || active.get(token) !== identity)
          throw failure("conflict", "Language-server reservation is no longer current", true);
      };

      return {
        identity,
        assertCurrent,
        validate: async (next) => {
          current(next);

          if (active.get(token) !== identity)
            throw failure("conflict", "Language-server reservation is no longer current", true);
        },
        release: async () => {
          if (!active.delete(token)) return;
          count--;

          if (!active.size) launches.delete(toolId);
        },
      };
    },
    stats: () => ({ selections: selections.size, launches: count, disposed }),
    dispose() {
      if (count || selections.size)
        throw failure("recovery-required", "Tool reservations require awaited cleanup", true);
      disposed = true;
    },
  };
}
