/**
 * The claim sheet's model (Paper MX-AA): one task's latest claim with its summary, checks, head
 * and branch, and its rail row so the verdict goes through the same outbox. Pure.
 */
import type { CheckReceipt } from "@polaris/protocol";
import { Match } from "effect";
import { shortSha } from "./copy.ts";
import { type Check, type ConstellationSource, type TaskRow, taskRow } from "./model.ts";
import type { Delivery } from "./outbox.ts";

export interface ClaimCheck extends Check {
  /** A short reported result ("23 pass", "clean"); longer output stays on the Host. */
  readonly detail: string | null;
}

export interface ClaimDetail {
  readonly taskId: string;
  readonly title: string;
  /** 1 for the task's first attempt. */
  readonly attempt: number;
  readonly summary: string;
  readonly checks: ReadonlyArray<ClaimCheck>;
  readonly head: string;
  readonly branch: string;
  /** The rail's row: `handed` is set while the claim waits on the user's verdict. */
  readonly row: TaskRow;
}

const DETAIL_MAX = 16;

const reported = (exitCode: number | null | undefined): Check["result"] => {
  if (exitCode == null) return "reported";

  return exitCode === 0 ? "passed" : "failed";
};

const checkOf = (receipt: CheckReceipt): ClaimCheck =>
  Match.value(receipt).pipe(
    Match.tag("Verified", (r) => ({ label: r.label, result: "passed" as const, detail: null })),
    Match.tag("Reported", (r) => ({
      label: r.label,
      result: reported(r.exitCode),
      detail: r.text.length <= DETAIL_MAX ? r.text : null,
    })),
    Match.exhaustive
  );

export const claimDetail = (
  source: ConstellationSource,
  taskId: string,
  now: number
): ClaimDetail | null => {
  const c = source.constellation;
  const task = c.tasks.find((t) => t.id === taskId);
  const projection = source.projections.find((p) => p.taskId === taskId);

  if (task === undefined || projection?.latestAttemptId == null) return null;
  const attempts = c.attempts.filter((a) => a.taskId === taskId);
  const index = attempts.findIndex((a) => a.id === projection.latestAttemptId);
  const attempt = attempts[index];
  const claim = attempt?.claim;
  const row = taskRow(c, task, new Map(source.projections.map((p) => [p.taskId, p])), now);

  if (attempt === undefined || claim == null || row === null) return null;

  return {
    taskId,
    title: task.title,
    attempt: index + 1,
    summary: claim.summary,
    checks: claim.receipts.map(checkOf),
    head: shortSha(claim.head),
    branch: claim.branch,
    row,
  };
};

/** What the sheet's foot shows: the two verdicts, the reason field, or how the verdict went. */
export type ClaimStep = "read-only" | "choose" | "reason" | "delivering" | "delivered";

export const claimStep = (
  detail: Pick<ClaimDetail, "row">,
  delivery: Delivery | null,
  askingReason: boolean
): ClaimStep => {
  if (delivery?.state === "delivered") return "delivered";

  if (delivery !== null) return "delivering";

  if (detail.row.handed === null) return "read-only";

  return askingReason ? "reason" : "choose";
};
