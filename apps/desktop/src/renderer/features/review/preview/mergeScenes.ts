/**
 * Opens a Merge scene's popover, or for `#review/merge-done` the done pane after #88 merged
 * with the toast that says what happened.
 */
import { PixelCheckIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import type { PullActionsView, ReviewerView } from "../../../../shared/githubActions.ts";
import { doneStore, mergedStore } from "../data/advance.ts";
import { mergedMessage } from "../merge/data/actions.ts";
import { openPanel } from "../merge/data/panels.ts";
import { pullsStore } from "../../pulls/store.ts";
import { MERGE_SCENES, SEARCH_RESULTS } from "./mergeFixtures.ts";
import { QUEUE_DONE_LIST } from "./queueFixtures.ts";

const TOAST_DELAY_MS = 400;

const showMergedToast = () => {
  const view = MERGE_SCENES.get("merge-ready")?.view.merge;

  if (view === undefined) return;

  showToast({
    source: "starlight",
    icon: createElement(PixelCheckIcon, { size: 16 }),
    title: "#88 merged",
    message: mergedMessage(
      {
        method: "squash",
        mergedAt: null,
        branch: {
          kind: "deleted",
          name: view.branch.name,
          sha: view.headRefOid,
          repo: view.repo,
          byGitHub: false,
        },
      },
      view,
      ["review checkout removed"]
    ),
    duration: 600_000,
    action: { label: "Restore branch", onAction: () => undefined },
  });
};

export const setUpMerge = (scene: string) => {
  const open = MERGE_SCENES.get(scene)?.open ?? null;

  if (open !== null) openPanel(open);

  if (scene !== "merge-done") return;
  // #88's group emptied: the list as it stood, its row merged away.
  pullsStore.setState({ list: QUEUE_DONE_LIST });
  mergedStore.setState({ merged: new Set(["PR_88"]) });
  doneStore.setState({ done: { pullId: "PR_88", group: "requested", moved: "merged" } });
  setTimeout(showMergedToast, TOAST_DELAY_MS);
};

/** The stand-in bridge's answers for Reviewers and Merge; null for anything else. */
export const mergeAnswer = (
  scene: string,
  method: string
): PullActionsView | ReadonlyArray<ReviewerView> | null => {
  if (method === "github.pull.actions") return MERGE_SCENES.get(scene)?.view ?? null;

  return method === "github.reviewers.search" ? SEARCH_RESULTS : null;
};
