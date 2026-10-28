/**
 * Verdicts on their way to the Host: Accept's approval and its message to the lead are one
 * delivery, kept until both land. A delivery is latched while in flight and retried under
 * the same command ids, so a double tap or a lost reply never doubles a side effect, and an
 * approval never lands without the user's answer staying visible until the lead has it.
 */
import type { CommandId } from "@polaris/protocol";
import type { HostConnection } from "../runtime/hostConnection.ts";
import {
  approveClaim,
  newCommandId,
  tellLead,
  type VerdictInput,
  VerdictRefused,
} from "./verdict.ts";

export type DeliveryStep = "approve" | "message";

/** The Host's two verdict commands. A VerdictRefused rejection is definite; any other is lost. */
export interface VerdictSteps {
  readonly approve: (input: VerdictInput, commandId: CommandId) => Promise<void>;
  readonly tell: (input: VerdictInput, commandId: CommandId) => Promise<void>;
}

export interface DeliveryFailure {
  readonly step: DeliveryStep;
  readonly message: string;
  /** The Host refused it, so nothing was recorded; otherwise the reply was lost. */
  readonly refused: boolean;
}

export interface Delivery {
  readonly key: string;
  readonly input: VerdictInput;
  readonly approveId: CommandId;
  readonly messageId: CommandId;
  /** The Host recorded the approval (Accept only). */
  readonly approved: boolean;
  readonly state: "sending" | "failed" | "delivered";
  readonly failure: DeliveryFailure | null;
}

type ClaimRef = Pick<VerdictInput, "attemptId" | "revision" | "head">;

/** A delivery belongs to one claim: its Attempt, the revision the user saw, and its head. */
export const deliveryKey = (
  input: Pick<VerdictInput, "constellationId" | "taskId"> & ClaimRef
): string =>
  [input.constellationId, input.taskId, input.attemptId, input.revision, input.head].join("/");

/** Nothing reached the Host, so the user may edit the answer or cancel. */
export const editable = (d: Delivery | null): boolean =>
  d === null || (d.state === "failed" && d.failure?.refused === true);

export const cancellable = (d: Delivery | null): boolean => editable(d) && d?.approved !== true;

/** What the row says about a delivery, naming the step that failed. */
export const deliveryLine = (d: Delivery): string => {
  const accept = d.input.verdict === "accept";

  if (d.state === "delivered")
    return accept ? "Approved, and the lead has your answer." : "Sent back to the lead.";

  if (d.state === "sending") {
    if (!accept) return "Telling the lead…";

    return d.approved ? "Approved. Telling the lead…" : "Approving…";
  }

  const { step, message, refused } = d.failure ?? { step: "message", message: "", refused: false };

  if (step === "approve")
    return refused ? `Not approved: ${message}` : `Not approved yet: ${message}`;
  const prefix = accept ? "Approved, but the lead" : "The lead";

  return refused
    ? `${prefix} can't get your answer: ${message}`
    : `${prefix} hasn't got your answer yet: ${message}`;
};

const failureOf = (step: DeliveryStep, error: Error): DeliveryFailure => ({
  step,
  message: error.message,
  refused: error instanceof VerdictRefused,
});

const attempt = (step: DeliveryStep, run: () => Promise<void>) =>
  run().then(
    () => null,
    (error: Error) => failureOf(step, error)
  );

const fresh = (key: string, input: VerdictInput): Delivery => ({
  key,
  input,
  approveId: newCommandId(),
  messageId: newCommandId(),
  approved: false,
  state: "sending",
  failure: null,
});

/** A lost step keeps its id and text; a refused one goes again as a new command, with any edit. */
const again = (d: Delivery, input: VerdictInput): Delivery =>
  d.failure?.refused === true
    ? {
        ...d,
        input: d.approved ? { ...input, verdict: d.input.verdict } : input,
        approveId: d.failure.step === "approve" ? newCommandId() : d.approveId,
        messageId: newCommandId(),
        state: "sending",
        failure: null,
      }
    : { ...d, state: "sending", failure: null };

export interface VerdictOutbox {
  /** Delivers a verdict; while one for the same claim is in flight, returns that one. */
  readonly submit: (steps: VerdictSteps, input: VerdictInput) => Promise<Delivery>;
  /** Re-sends every lost delivery in a constellation, as after a reconnect. */
  readonly retryLost: (steps: VerdictSteps, constellationId: string) => void;
  /** Drops a delivery nothing of which reached the Host. */
  readonly cancel: (key: string) => void;
  /** The current claim's delivery, else an undelivered one the row moved on from. */
  readonly find: (
    constellationId: string,
    taskId: string,
    claim: ClaimRef | null
  ) => Delivery | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly version: () => number;
}

export const createVerdictOutbox = (): VerdictOutbox => {
  const entries = new Map<string, Delivery>();
  const inflight = new Map<string, Promise<Delivery>>();
  const listeners = new Set<() => void>();
  let version = 0;

  const put = (d: Delivery) => {
    entries.set(d.key, d);
    version += 1;

    for (const listener of listeners) listener();

    return d;
  };

  const deliver = async (steps: VerdictSteps, start: Delivery): Promise<Delivery> => {
    let d = put(start);

    if (d.input.verdict === "accept" && !d.approved) {
      const failure = await attempt("approve", () => steps.approve(d.input, d.approveId));

      if (failure !== null) return put({ ...d, state: "failed", failure });
      d = put({ ...d, approved: true });
    }

    const failure = await attempt("message", () => steps.tell(d.input, d.messageId));

    return put(
      failure === null ? { ...d, state: "delivered" } : { ...d, state: "failed", failure }
    );
  };

  const submit = (steps: VerdictSteps, input: VerdictInput): Promise<Delivery> => {
    const key = deliveryKey(input);
    const running = inflight.get(key);

    if (running !== undefined) return running;
    const existing = entries.get(key);

    if (existing?.state === "delivered") return Promise.resolve(existing);
    const run = deliver(steps, existing === undefined ? fresh(key, input) : again(existing, input));

    inflight.set(key, run);
    void run.finally(() => inflight.delete(key));

    return run;
  };

  return {
    submit,
    retryLost: (steps, constellationId) => {
      for (const d of entries.values())
        if (
          d.input.constellationId === constellationId &&
          d.state === "failed" &&
          !d.failure?.refused
        )
          void submit(steps, d.input);
    },
    cancel: (key) => {
      const d = entries.get(key);

      if (d === undefined || !cancellable(d) || inflight.has(key)) return;
      entries.delete(key);
      version += 1;

      for (const listener of listeners) listener();
    },
    find: (constellationId, taskId, claim) => {
      if (claim !== null)
        return entries.get(deliveryKey({ constellationId, taskId, ...claim })) ?? null;

      for (const d of entries.values())
        if (
          d.input.constellationId === constellationId &&
          d.input.taskId === taskId &&
          d.state !== "delivered"
        )
          return d;

      return null;
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    version: () => version,
  };
};

/** The app's outbox: it outlives the screen, the claim's row and the connection. */
export const verdictOutbox = createVerdictOutbox();

export const hostSteps = (connection: HostConnection): VerdictSteps => ({
  approve: (input, id) => connection.run((client) => approveClaim(client, input, id)),
  tell: (input, id) => connection.run((client) => tellLead(client, input, id)),
});
