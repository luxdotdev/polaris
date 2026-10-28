/** Review's submission slots as React state, sending through the Host's live connection. */
import type { Command } from "@polaris/protocol";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { LiveHost } from "../runtime/hostConnection.ts";
import { dispatchReview } from "./actions.ts";
import { reviewSubmissions, type SubmissionState } from "./submissions.ts";

export interface ReviewSubmit {
  /** Answers why it failed, or null; "The host isn't connected" when there's no connection. */
  readonly submit: (
    slot: string,
    payload: string,
    build: (itemId: string) => Command
  ) => Promise<string | null>;
  readonly state: (slot: string) => SubmissionState | null;
  /** Changes whenever a slot's state does, for memos that read `state`. */
  readonly version: number;
}

export const useReviewSubmissions = (live: LiveHost | null): ReviewSubmit => {
  const [submissions] = useState(reviewSubmissions);
  const version = useSyncExternalStore(submissions.subscribe, submissions.version);

  const submit = useCallback<ReviewSubmit["submit"]>(
    (slot, payload, build) =>
      live === null
        ? Promise.resolve("The host isn't connected")
        : submissions.submit(slot, payload, build, (command, id) =>
            dispatchReview(live.client, command, id)
          ),
    [live, submissions]
  );

  return { submit, state: submissions.state, version };
};
