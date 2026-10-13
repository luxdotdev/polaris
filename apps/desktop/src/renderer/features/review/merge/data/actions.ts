/**
 * Merging from Review and what follows it: the merge (or auto-merge) on GitHub, then the
 * follow-ups the user ticked: the Review Checkout removed, the linked Agent Session archived,
 * the queue moved on, and a toast with what happened ("Restore branch" when it went).
 */
import { SessionId } from "@polaris/protocol";
import { PixelCheckIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import type {
  BranchOutcome,
  MergeMethod,
  MergeResult,
  MergeView,
} from "../../../../../shared/githubActions.ts";
import { Commands } from "../../../../commands.ts";
import { polaris } from "../../../bridge.ts";
import { send, showRefusal } from "../../../session/dispatch.ts";
import { type Held, removeCheckout } from "../../checkout/actions.ts";
import { pullMerged } from "../../data/advance.ts";
import { refreshPullDetail } from "../../data/pullDetail.ts";
import type { LinkedSession } from "../model/local.ts";
import { rememberMethod } from "./prefs.ts";
import { refreshActions } from "./store.ts";

export interface MergeChoice {
  readonly pull: OpenPull;
  readonly view: MergeView;
  readonly method: MergeMethod;
  readonly title: string;
  readonly body: string;
  /** Delete the head branch on GitHub (when nothing keeps it). */
  readonly deleteBranch: boolean;
  /** The Review Checkout to remove; null to keep it, or when there is none. */
  readonly checkout: Held | null;
  /** The linked Agent Session to archive, and whether its branch goes too (only if merged). */
  readonly archive: { readonly session: LinkedSession; readonly deleteBranch: boolean } | null;
}

export type MergeOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

const fields = (choice: MergeChoice) => ({
  pull: { repo: choice.pull.repo, number: choice.pull.number },
  pullId: choice.view.pullId,
  method: choice.method,
  title: choice.title,
  body: choice.body,
  expectedHeadOid: choice.view.headRefOid,
});

const PAST: Readonly<Record<MergeMethod, string>> = {
  merge: "Merged",
  squash: "Squashed",
  rebase: "Rebased",
};

const branchLine = (branch: BranchOutcome) => {
  if (branch.kind === "deleted") return `${branch.name} deleted`;

  return branch.kind === "failed" ? `${branch.name} not deleted: ${branch.message}` : null;
};

export const restoreBranch = async (
  branch: Extract<BranchOutcome, { kind: "deleted" }>,
  view: MergeView
) => {
  const input = { repo: branch.repo, name: branch.name, sha: branch.sha };

  const result = await polaris().request(
    "github.branch.restore",
    view.host === undefined ? input : { ...input, host: view.host }
  );

  if (!result.ok) {
    showRefusal(`Couldn’t restore ${branch.name}`, result.error);

    return;
  }

  showToast({
    source: "starlight",
    icon: createElement(PixelCheckIcon, { size: 16 }),
    title: `Restored ${branch.name}`,
    message: `At ${branch.sha.slice(0, 7)} on ${branch.repo}`,
  });
};

/** One line of what the merge did, for the toast. */
export const mergedMessage = (result: MergeResult, view: MergeView, local: ReadonlyArray<string>) =>
  [`${PAST[result.method]} into ${view.baseRefName}`, branchLine(result.branch), ...local]
    .filter((part): part is string => part !== null)
    .join(" · ");

const followUps = async (choice: MergeChoice) => {
  const done: Array<string> = [];

  if (choice.checkout !== null && (await removeCheckout(choice.checkout, choice.pull, "merged")))
    done.push("review checkout removed");

  if (choice.archive !== null) {
    const archived = await send(
      choice.archive.session.hostKey,
      Commands.ArchiveSession({
        sessionId: SessionId.make(choice.archive.session.sessionId),
        deleteMergedBranch: choice.archive.deleteBranch,
      }),
      "Couldn’t archive the agent session"
    );

    if (archived) done.push("agent session archived");
  }

  return done;
};

export const mergePull = async (choice: MergeChoice): Promise<MergeOutcome> => {
  const result = await polaris().request("github.pull.merge", {
    ...fields(choice),
    deleteBranch: choice.deleteBranch,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  rememberMethod(choice.view.viewerLogin, choice.view.repo, choice.method);
  pullMerged(choice.view.pullId);
  const local = await followUps(choice);
  const { branch } = result.value;

  const toast = {
    source: "starlight" as const,
    icon: createElement(PixelCheckIcon, { size: 16 }),
    title: `#${choice.view.number} merged`,
    message: mergedMessage(result.value, choice.view, local),
    duration: 10_000,
  };

  if (branch.kind === "deleted") {
    const action = {
      label: "Restore branch",
      onAction: () => void restoreBranch(branch, choice.view),
    };

    showToast({ ...toast, action });
  } else showToast(toast);
  void refreshActions(choice.pull);
  void refreshPullDetail(choice.pull);

  return { ok: true };
};

/** Turns auto-merge on: GitHub merges once what blocks it clears. Follow-ups don't run. */
export const enableAutoMerge = async (choice: MergeChoice): Promise<MergeOutcome> => {
  const result = await polaris().request("github.pull.autoMerge", {
    ...fields(choice),
    enable: true,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  rememberMethod(choice.view.viewerLogin, choice.view.repo, choice.method);
  showToast({
    source: "starlight",
    icon: createElement(PixelCheckIcon, { size: 16 }),
    title: `Auto-merge on for #${choice.view.number}`,
    message: `GitHub merges it into ${choice.view.baseRefName} once it can`,
  });
  void refreshActions(choice.pull);

  return { ok: true };
};

export const disableAutoMerge = async (pull: OpenPull, view: MergeView): Promise<MergeOutcome> => {
  const method = view.autoMerge.enabled?.method ?? view.defaultMethod;

  const result = await polaris().request("github.pull.autoMerge", {
    pull: { repo: pull.repo, number: pull.number },
    pullId: view.pullId,
    method,
    title: "",
    body: "",
    expectedHeadOid: view.headRefOid,
    enable: false,
  });

  if (!result.ok) return { ok: false, message: result.error.message };
  void refreshActions(pull);

  return { ok: true };
};
