/**
 * Turns sent from the composer that the thread doesn't show yet (MX-AV): one sent while the Host
 * is away waits, queued, and goes once it is back; one that fails stays with why, to send again.
 */
import type { Attachment, Command } from "@polaris/protocol";

export type SendStatus =
  /** Sent while the Host was away: it goes once the Host is back. */
  | "queued"
  /** On its way to the Host. */
  | "sending"
  /** The Host took it; waiting for its Turn to show in the thread. */
  | "sent"
  | "failed";

export interface OutgoingSend {
  readonly id: string;
  readonly text: string;
  readonly attachments: ReadonlyArray<Attachment>;
  readonly command: Command;
  /** The session's Turn count when it was sent: its Turn is the one past it. */
  readonly baseline: number;
  readonly status: SendStatus;
  /** Why it failed, as the user reads it. */
  readonly error: string | null;
}

let counter = 0;

export const outgoingSend = (fields: {
  readonly text: string;
  readonly attachments: ReadonlyArray<Attachment>;
  readonly command: Command;
  readonly turnCount: number;
  readonly away: boolean;
}): OutgoingSend => {
  counter += 1;

  return {
    id: `send-${counter}`,
    text: fields.text.trim(),
    attachments: fields.attachments,
    command: fields.command,
    baseline: fields.turnCount,
    status: fields.away ? "queued" : "sending",
    error: null,
  };
};

/** A send still on its way: the next message waits for it, as a follow-up. */
export const pendingSend = (sends: ReadonlyArray<OutgoingSend>): OutgoingSend | null =>
  sends.find((entry) => entry.status !== "failed") ?? null;

/** A send whose Turn the thread now holds drops out; the same array when nothing changed. */
export const settleSends = (
  sends: ReadonlyArray<OutgoingSend>,
  turnCount: number
): ReadonlyArray<OutgoingSend> => {
  const next = sends.filter((entry) => entry.status !== "sent" || turnCount <= entry.baseline);

  return next.length === sends.length ? sends : next;
};

/** The Host is back: what was queued is on its way. The same array when nothing was queued. */
export const dispatchQueued = (sends: ReadonlyArray<OutgoingSend>): ReadonlyArray<OutgoingSend> =>
  sends.some((entry) => entry.status === "queued")
    ? sends.map((entry) => (entry.status === "queued" ? { ...entry, status: "sending" } : entry))
    : sends;
