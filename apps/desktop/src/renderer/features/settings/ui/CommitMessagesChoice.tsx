/**
 * Settings → Editor's "Commit messages" (Paper 15c): the Reviewer's Harness and Model
 * chips without Effort. A new Harness starts on its small, fast Model.
 */
import { commitMessageModel } from "../../../../shared/sessionPrefs.ts";
import { setSessionPrefs, useSettings } from "../store.ts";
import { ReviewerChoice } from "./ReviewerChoice.tsx";
import { useModelHost } from "./ReviewerPage.tsx";

export const CommitMessagesChoice = () => {
  const choice = useSettings((s) => s.sessions.commitMessages);
  const modelHost = useModelHost();

  return (
    <ReviewerChoice
      value={choice}
      allowAuto={false}
      modelOnly
      modelHost={modelHost}
      onChange={(next) => {
        if (next === null) return;

        const model =
          next.harness === choice.harness ? next.model : commitMessageModel(next.harness);

        setSessionPrefs({ commitMessages: { harness: next.harness, model, effort: null } });
      }}
    />
  );
};
