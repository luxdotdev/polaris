/** A failed settle in words (DESIGN.md, Polaris-authored cards): only implementation is the worker's. */
import type { FailureKind } from "@polaris/protocol";
import { clock } from "./copy.ts";

const KIND_WORD: Readonly<Record<FailureKind, string>> = {
  capacity: "usage limit",
  transport: "connection",
  harness: "harness error",
  implementation: "implementation",
};

export const failureKindWord = (kind: FailureKind) => KIND_WORD[kind];

/** Capacity, connection and harness failures read neutral: they aren't the worker's work. */
export const neutralFailure = (kind: FailureKind | null | undefined) =>
  kind != null && kind !== "implementation";

/** "resets 14:00", or "reset time unknown" when the Harness gave none. */
export const capacityReset = (resetsAt: string | null | undefined) =>
  resetsAt == null ? "reset time unknown" : `resets ${clock(resetsAt)}`;

/** A failed rail row's second line: "resets 14:00" for a usage limit, else the kind. */
export const failureNote = (kind: FailureKind, resetsAt: string | null | undefined) =>
  kind === "capacity" ? capacityReset(resetsAt) : KIND_WORD[kind];

/** The digest's words: "Usage limit · resets 14:00", "failed · connection", "failed". */
export const failedText = (
  kind: FailureKind | null | undefined,
  resetsAt: string | null | undefined
) => {
  if (kind == null) return "failed";

  if (kind === "capacity") return `Usage limit · ${capacityReset(resetsAt)}`;

  return `failed · ${KIND_WORD[kind]}`;
};
