/**
 * The composer's floating notice strip (Paper MX-E, MX-D's strip): the oldest open request,
 * with the rest behind "+n", else Working while a Turn runs. Nothing to know, no strip.
 */
import type { ApprovalRequest } from "@polaris/protocol";
import { approvalDetail } from "../home/model/lines.ts";

const WANTS: Readonly<Record<ApprovalRequest["kind"], string>> = {
  command: "wants to run",
  "file-change": "wants to change files",
  tool: "wants to use a tool",
  question: "has a question",
};

/** What fits beside Approve and Deny on the narrowest iPhone; longer opens to the whole request. */
export const COMPACT_CHARACTERS = 20;

/** Printable ASCII only: no line breaks, controls, bidi or zero-width marks that hide text. */
const PLAIN = /^[\x20-\x7e]*$/;

export type StripNotice =
  | {
      readonly kind: "approval";
      readonly request: ApprovalRequest;
      /** "Claude Code wants to run". */
      readonly headline: string;
      /** Every line of the command, file or tool; null when the Harness named none. */
      readonly detail: string | null;
      /** Short plain text: Approve may sit beside it; the view still opens if it wraps. */
      readonly compact: boolean;
    }
  | { readonly kind: "question"; readonly request: ApprovalRequest }
  | { readonly kind: "working" };

export interface Strip {
  readonly notice: StripNotice;
  /** Requests behind this one. */
  readonly more: number;
}

const fitsOneLine = (text: string) => PLAIN.test(text) && text.length <= COMPACT_CHARACTERS;

const noticeOf = (request: ApprovalRequest, harness: string): StripNotice => {
  if (request.kind === "question") return { kind: "question", request };
  const detail = approvalDetail(request)?.text ?? null;

  return {
    kind: "approval",
    request,
    headline: `${harness} ${WANTS[request.kind]}`,
    detail,
    compact: detail === null || fitsOneLine(detail),
  };
};

/** Every open request as the strip shows it, oldest first. */
export const noticesOf = (
  requests: ReadonlyArray<ApprovalRequest>,
  harness: string
): ReadonlyArray<StripNotice> =>
  [...requests]
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
    .map((request) => noticeOf(request, harness));

/**
 * The strip: requests first, oldest first, whether or not the Turn is still working (a
 * Subagent can ask while the lead works on); Working only when nothing is asked.
 */
export const stripOf = ({
  requests,
  working,
  harness,
}: {
  readonly requests: ReadonlyArray<ApprovalRequest>;
  readonly working: boolean;
  /** The Harness's name, "Claude Code". */
  readonly harness: string;
}): Strip | null => {
  const oldest = noticesOf(requests, harness)[0];

  if (oldest !== undefined) return { notice: oldest, more: requests.length - 1 };

  return working ? { notice: { kind: "working" }, more: 0 } : null;
};
