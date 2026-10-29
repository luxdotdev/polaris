/**
 * The composer's notice strip (DESIGN.md, Chrome redesign: The composer): what there is to
 * know now, by priority. The strip shows the first and keeps the rest behind "+n".
 */
import type { ApprovalRequest } from "@polaris/protocol";
import { CONTEXT_NEARLY_FULL } from "./meta.ts";
import type { Outgoing } from "./outbox.ts";

export type Notice =
  | { readonly kind: "approval"; readonly request: ApprovalRequest }
  | { readonly kind: "working" }
  | { readonly kind: "queued"; readonly entries: ReadonlyArray<Outgoing> }
  | { readonly kind: "context"; readonly share: number }
  | { readonly kind: "limited"; readonly resetsAt: string | null };

export interface NoticeInput {
  readonly approvals: ReadonlyArray<ApprovalRequest>;
  readonly working: boolean;
  readonly outbox: ReadonlyArray<Outgoing>;
  /** The share of the context window in use; null when the window is unknown. */
  readonly contextShare: number | null;
  /** The user closed the nearly-full notice at this share or above it. */
  readonly contextDismissedAt: number | null;
  readonly limited: boolean;
  readonly resetsAt: string | null;
}

const nearlyFull = (input: NoticeInput): number | null => {
  const share = input.contextShare;

  if (share === null || share < CONTEXT_NEARLY_FULL) return null;

  return input.contextDismissedAt !== null && share <= input.contextDismissedAt ? null : share;
};

/** Every notice that applies, highest priority first; the Goal joins once Goals exist (ENG-503). */
export const notices = (input: NoticeInput): ReadonlyArray<Notice> => {
  const queued = input.outbox.filter((o) => o.kind === "queued" && o.status === "waiting");
  const share = nearlyFull(input);
  const first = input.approvals[0];

  return [
    first === undefined ? null : { kind: "approval" as const, request: first },
    input.working ? { kind: "working" as const } : null,
    queued.length === 0 ? null : { kind: "queued" as const, entries: queued },
    share === null ? null : { kind: "context" as const, share },
    input.limited ? { kind: "limited" as const, resetsAt: input.resetsAt } : null,
  ].filter((n) => n !== null);
};

const WANTS: Readonly<Record<ApprovalRequest["kind"], string>> = {
  command: "wants to run",
  "file-change": "wants to change files",
  tool: "wants to use a tool",
  question: "has a question",
};

/** Longer than this, a command can't be read whole in the strip. */
const STRIP_COMMAND_MAX = 60;

/**
 * How the strip shows a request. Approve sits there only for a one-line command short enough
 * to be read whole; anything else is approved from the full card in the conversation.
 */
export const approvalNotice = (request: ApprovalRequest) => {
  const full = request.kind === "question" ? null : (request.detail ?? request.title);

  const whole =
    request.kind === "command" &&
    full !== null &&
    !full.includes("\n") &&
    full.length <= STRIP_COMMAND_MAX;

  return {
    wants: WANTS[request.kind],
    shown: request.kind === "command" ? full : null,
    full,
    decide: whole,
  };
};
