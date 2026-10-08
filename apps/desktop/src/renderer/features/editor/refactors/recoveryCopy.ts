/**
 * The refactor recovery strip's sentence and actions (DESIGN.md, Editor: Refactor recovery). It
 * names what happened and to which files, in the disk-change strip's voice.
 */
import type { DraftGroup } from "./group.ts";

export type RecoveryAction = "check" | "undo" | "dismiss";

export interface RecoveryCopy {
  readonly text: string;
  readonly actions: readonly { readonly action: RecoveryAction; readonly label: string }[];
}

const name = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** "a.ts", "a.ts and b.ts", "a.ts, b.ts and 3 more". */
export const filesIn = (paths: readonly string[]) => {
  const names = paths.map(name);

  if (names.length <= 2) return names.join(" and ");

  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
};

/** The refactor as its proposal names it ("Rename symbol"), in running text. */
const what = (group: Pick<DraftGroup, "proposal">) => {
  const label = group.proposal.label.trim();

  return label === "" ? "The refactor" : label;
};

/** A refactor that failed outside its preview: one line, the reason without its error class. */
export const failureCopy = (message: string): RecoveryCopy => ({
  text: `Couldn't finish the refactor. ${message.replace(/^\w*Error: /, "")}`,
  actions: [{ action: "dismiss", label: "Dismiss" }],
});

export const recoveryCopy = (
  group: Pick<DraftGroup, "state" | "touched" | "proposal" | "outcome">
): RecoveryCopy => {
  const files = filesIn(group.touched);
  const check = { action: "check", label: "Check again" } as const;
  const undo = { action: "undo", label: "Undo" } as const;

  if (group.state === "partial")
    return { text: `${what(group)} stopped partway through ${files}.`, actions: [check, undo] };

  return {
    text: `${what(group)}: couldn't confirm it finished in ${files}.`,
    actions: group.outcome === null ? [check] : [check, undo],
  };
};
