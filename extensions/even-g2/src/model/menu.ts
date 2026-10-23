/**
 * The actions menu for one Agent Session: answers to its oldest pending
 * approval, Interrupt and Continue, fixed replies, and speaking a reply.
 */
import type { ApprovalRequest, SessionEntry, Turn } from "@polaris/sdk";
import { clip, MAX_ROW_BYTES, MAX_ROWS } from "./sessions.ts";

export type TurnStatus = Turn["status"];

export type MenuAction =
  | { readonly kind: "allow"; readonly requestId: string }
  | { readonly kind: "deny"; readonly requestId: string }
  | { readonly kind: "answer"; readonly requestId: string; readonly text: string }
  | { readonly kind: "interrupt" }
  | { readonly kind: "continue" }
  | { readonly kind: "reply"; readonly text: string }
  | { readonly kind: "speak" };

export interface MenuItem {
  readonly label: string;
  readonly action: MenuAction;
}

export const FIXED_REPLIES = ["Go ahead", "Run the tests", "Summarize where you are"] as const;

const approvalItems = (approval: ApprovalRequest): ReadonlyArray<MenuItem> =>
  approval.kind === "question"
    ? [
        ...approval.options.map((option) => ({
          label: clip(option, MAX_ROW_BYTES),
          action: { kind: "answer", requestId: approval.id, text: option } as const,
        })),
        { label: "Speak an answer", action: { kind: "speak" } },
        { label: "Deny", action: { kind: "deny", requestId: approval.id } },
      ]
    : [
        { label: "Approve", action: { kind: "allow", requestId: approval.id } },
        { label: "Deny", action: { kind: "deny", requestId: approval.id } },
      ];

const busy = new Set(["starting", "working", "needs-you"]);

/** `lastTurn` is the status of the session's latest Turn, when known. */
export const menuFor = (
  entry: SessionEntry,
  lastTurn: TurnStatus | null
): ReadonlyArray<MenuItem> => {
  const approval = entry.pendingApprovals[0];
  const working = busy.has(entry.session.state);

  const items: ReadonlyArray<MenuItem> = [
    ...(approval === undefined ? [] : approvalItems(approval)),
    ...(working ? [{ label: "Interrupt", action: { kind: "interrupt" } } as const] : []),
    ...(!working && lastTurn === "interrupted"
      ? [{ label: "Continue", action: { kind: "continue" } } as const]
      : []),
    ...(working
      ? []
      : [
          ...FIXED_REPLIES.map((text) => ({
            label: `Reply: ${text}`,
            action: { kind: "reply", text } as const,
          })),
          { label: "Speak a reply", action: { kind: "speak" } } as const,
        ]),
  ];

  return items.slice(0, MAX_ROWS);
};

/** What the Session screen says once an action has gone through. */
export const DONE: Record<Exclude<MenuAction["kind"], "speak">, string> = {
  allow: "Approved",
  deny: "Denied",
  answer: "Answered",
  interrupt: "Interrupted",
  continue: "Continued",
  reply: "Sent",
};
