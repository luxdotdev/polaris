/** The walkthrough's words in a turn's Review (Paper MX-N's hero line, MX-U's sheet). */
import type { IntentGroup, RiskSummary } from "@polaris/protocol";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export interface WalkthroughLine {
  readonly text: string;
  /** Its groups, once the walkthrough is ready: the line opens them. */
  readonly groups: ReadonlyArray<IntentGroup> | null;
}

/** The hero's one line about the walkthrough; null when it's off or the Host has none. */
export const walkthroughLine = (summary: RiskSummary | null): WalkthroughLine | null => {
  const walkthrough = summary?.walkthrough;

  if (walkthrough === undefined) return null;

  switch (walkthrough.state) {
    case "off":
      return null;
    case "waiting":
      return { text: "Walkthrough · waiting to run", groups: null };
    case "writing":
      return { text: "Walkthrough · writing…", groups: null };
    case "failed":
      return { text: "Walkthrough couldn’t finish", groups: null };
    case "ready": {
      const groups = walkthrough.groups ?? [];

      return groups.length === 0
        ? { text: "Walkthrough · no intent groups", groups: null }
        : { text: `Walkthrough · ${plural(groups.length, "intent group")}`, groups };
    }
  }
};

/** MX-U's subtitle: "Turn 24 · 3 intent groups · 1 needs extra care". */
export const walkthroughCaption = (turnNumber: number, groups: ReadonlyArray<IntentGroup>) => {
  const care = groups.filter((g) => g.critical).length;
  const parts = [`Turn ${turnNumber}`, plural(groups.length, "intent group")];

  return (
    care === 0 ? parts : [...parts, `${care} ${care === 1 ? "needs" : "need"} extra care`]
  ).join(" · ");
};
