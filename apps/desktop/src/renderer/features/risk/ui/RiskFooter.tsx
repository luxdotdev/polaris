/** The risk column's foot: "Ask the reviewer", once a summary with a Reviewer is open. */
import { type ReviewSlotProps, subjectKey as keyOf } from "../../review/index.ts";
import { useRisk } from "../data/riskStore.ts";
import { AskReviewer } from "./AskReviewer.tsx";

export const RiskFooterSlot = (props: ReviewSlotProps) => {
  const key = keyOf(props.subject);
  const state = useRisk(key);

  if (state.kind !== "ready") return null;

  return (
    <div className="border-hairline border-t">
      <AskReviewer subjectKey={key} hostKey={state.hostKey} summary={state.summary} />
    </div>
  );
};
