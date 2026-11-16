/**
 * How the Session machine's transition functions answer (README.md here): the folded
 * session they read, and the events, state change or rejection they emit.
 */
import type { DomainEvent, SessionState } from "@polaris/protocol";
import type { SessionRecord } from "../store/model.ts";
import { foldEach, stateChanged } from "./session.events.ts";
import type { Emitted } from "./session.inputs.ts";

export interface Context {
  /** The folded session; null before it exists. */
  readonly record: SessionRecord | null;
}

export const need = (context: Context): SessionRecord => {
  if (context.record === null) throw new Error("the session machine needs a session");

  return context.record;
};

export type Enqueue = { emit: (emitted: Emitted) => void };

/**
 * How XState v6 transition functions read here: returning `undefined` means
 * "not taken", and the event bubbles to the machine-level default; returning
 * an object (even `HANDLED`, no target) takes the transition and stops it.
 */
export const HANDLED = {};

/**
 * Emit `events`, then (with `enter`) the Session State change they lead to,
 * and move to the state the fold of all of them gives. A state change
 * re-enters its state, so entry effects run for every `SessionStateChanged`.
 * With nothing to emit it is still taken (`HANDLED`).
 */
export const settle = (
  enq: Enqueue,
  record: SessionRecord | null,
  events: ReadonlyArray<DomainEvent>,
  enter?: {
    readonly state: SessionState;
    readonly reason?: string | null;
    readonly resetsAt?: string | null;
  }
) => {
  const sessionId =
    record?.session.id ?? (events[0]?._tag === "SessionCreated" ? events[0].session.id : undefined);

  if (sessionId === undefined) return undefined;

  const all = enter
    ? [...events, stateChanged(sessionId, enter.state, enter.reason, enter.resetsAt)]
    : events;

  if (all.length === 0) return HANDLED;

  const folded = foldEach(sessionId, record ?? undefined, all);

  for (const event of folded.events) enq.emit({ type: "domain", event });
  const next = folded.record!;
  const moved = enter !== undefined || next.session.state !== record?.session.state;

  const context = { record: next };

  return moved ? { target: `#${next.session.state}`, reenter: true, context } : { context };
};

export const reject = (enq: Enqueue, reason: string | null) => {
  if (reason !== null) enq.emit({ type: "rejected", reason });
};
