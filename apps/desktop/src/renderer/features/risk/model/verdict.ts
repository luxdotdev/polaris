/** A Verdict's choices as the popover offers them (ENG-225), and what a thumbs-down needs. */
import type { VerdictReason, VerdictScope } from "@polaris/protocol";

export const REASONS: ReadonlyArray<{ readonly value: VerdictReason; readonly label: string }> = [
  { value: "false-positive", label: "False positive" },
  { value: "not-important", label: "Not important" },
  { value: "intended", label: "Intended" },
  { value: "already-handled", label: "Already handled" },
  { value: "wrong-severity", label: "Wrong severity" },
  { value: "out-of-scope", label: "Out of scope" },
  { value: "other", label: "Other…" },
];

export const SCOPES: ReadonlyArray<{ readonly value: VerdictScope; readonly label: string }> = [
  { value: "change", label: "This change" },
  { value: "repo", label: "This repo" },
  { value: "everywhere", label: "Everywhere" },
];

/** Why the thumbs-down can't be saved yet, or null: it needs a reason, and "Other" a note. */
export const verdictProblem = (
  reasons: ReadonlyArray<VerdictReason>,
  text: string
): string | null => {
  if (reasons.length === 0 && text.trim() === "") return "Pick a reason";

  if (reasons.includes("other") && text.trim() === "") return "Say why";

  return null;
};

const REASON_LABEL = new Map(REASONS.map((r) => [r.value, r.label.replace("…", "")]));

/** "You dismissed a similar finding here: intended" (ENG-225's history line). */
export const historyLine = (verdict: {
  readonly thumb: "up" | "down";
  readonly reasons: ReadonlyArray<VerdictReason>;
  readonly text: string | null;
}): string => {
  if (verdict.thumb === "up") return "You confirmed a similar finding here before";

  const parts = verdict.reasons.flatMap((r) =>
    r === "other" ? [] : [REASON_LABEL.get(r)?.toLowerCase() ?? r]
  );

  if (verdict.text !== null && verdict.text.trim() !== "") parts.push(verdict.text.trim());
  const why = parts.join(", ");

  return why === ""
    ? "You dismissed a similar finding here"
    : `You dismissed a similar finding here: ${why}`;
};
