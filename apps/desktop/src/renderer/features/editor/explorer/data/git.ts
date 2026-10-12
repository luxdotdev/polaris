/**
 * The Changes tab's writes (capability `git.write`): stage, unstage, discard
 * and commit. Each write re-reads `git.status`; a refusal toasts the Host's reason.
 */
import type { GitCommitItem } from "@polaris/protocol";
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { Match } from "effect";
import { createElement } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { polaris } from "../../../bridge.ts";
import type { StageRow } from "../model/stage.ts";
import type { TabsView } from "../../index.ts";
import { type DeleteOutcome, deleteEntry, type Place } from "./actions.ts";
import { refreshGit } from "./fetch.ts";

/** A commit in this explorer: its message as typed, and the last run's hook output. */
export interface CommitDraft {
  readonly message: string;
  readonly run:
    | { readonly kind: "idle" }
    | { readonly kind: "running"; readonly startedAt: number; readonly output: string }
    | { readonly kind: "failed"; readonly output: string; readonly exitCode: number | null };
  /** The subject of the commit just made, until the next edit to the message. */
  readonly committed: string | null;
}

const blank: CommitDraft = { message: "", run: { kind: "idle" }, committed: null };

const drafts = createStore<Record<string, CommitDraft>>(() => ({}));

const patch = (key: string, change: (d: CommitDraft) => Partial<CommitDraft>) =>
  drafts.setState((s) => {
    const current = s[key] ?? blank;

    return { [key]: { ...current, ...change(current) } };
  });

export const useCommitDraft = (key: string) => useStore(drafts, (s) => s[key] ?? blank);

export const setMessage = (key: string, message: string) =>
  patch(key, () => ({ message, committed: null }));

/** Hooks can print a lot; the tab keeps the end, where the reason usually is. */
const KEPT_OUTPUT = 64 * 1024;

const appended = (output: string, text: string) => (output + text).slice(-KEPT_OUTPUT);

const failed = (title: string, message: string) =>
  showToast({
    source: "starlight",
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message,
  });

type PathsMethod = "git.stage" | "git.unstage" | "git.discard";

const write = async (
  place: Place,
  cwd: string,
  method: PathsMethod,
  paths: ReadonlyArray<string>
) => {
  if (paths.length === 0) return;
  const result = await polaris().request(method, { hostKey: place.hostKey, cwd, paths });

  if (!result.ok) failed("Couldn't change the index", result.error.message);
  await refreshGit(place.key, place.hostKey, place.root);
};

export const stage = (place: Place, cwd: string, paths: ReadonlyArray<string>) =>
  write(place, cwd, "git.stage", paths);

export const unstage = (place: Place, cwd: string, paths: ReadonlyArray<string>) =>
  write(place, cwd, "git.unstage", paths);

/** Tracked: back to the index's version. Untracked: to the Host's trash, as Delete does. */
export const discard = async (
  place: Place,
  cwd: string,
  row: StageRow,
  tabs: TabsView
): Promise<DeleteOutcome> => {
  if (!row.untracked) {
    await write(place, cwd, "git.discard", row.paths);

    return "done";
  }

  const outcome = await deleteEntry(place, row.path, false, tabs);
  await refreshGit(place.key, place.hostKey, place.root);

  return outcome;
};

/** Where the Host has no trash, after ConfirmDelete. */
export const deleteForGood = async (place: Place, path: string, tabs: TabsView) => {
  await deleteEntry(place, path, true, tabs);
  await refreshGit(place.key, place.hostKey, place.root);
};

const outputOf = (d: CommitDraft | undefined) => (d?.run.kind === "running" ? d.run.output : "");

const onItem = (place: Place, message: string, item: GitCommitItem) => {
  const settle = (change: Partial<CommitDraft>) => {
    patch(place.key, () => change);
    void refreshGit(place.key, place.hostKey, place.root);
  };

  Match.value(item).pipe(
    Match.tagsExhaustive({
      Output: ({ text }) =>
        patch(place.key, (d) =>
          d.run.kind === "running"
            ? { run: { ...d.run, output: appended(d.run.output, text) } }
            : {}
        ),
      Committed: () =>
        settle({ message: "", run: { kind: "idle" }, committed: message.split("\n")[0] ?? "" }),
      Failed: ({ exitCode }) =>
        settle({
          run: { kind: "failed", exitCode, output: outputOf(drafts.getState()[place.key]) },
        }),
    })
  );
};

/** Streams the hooks' output into the draft; the message stays until the commit lands. */
export const commit = (place: Place, cwd: string) => {
  const { message } = drafts.getState()[place.key] ?? blank;

  patch(place.key, () => ({ run: { kind: "running", startedAt: Date.now(), output: "" } }));

  polaris().subscribe(
    "git.commit",
    { hostKey: place.hostKey, cwd, message },
    {
      items: (items) => {
        for (const item of items) onItem(place, message, item);
      },
      end: (error) => {
        if (error === null) return;
        const output = outputOf(drafts.getState()[place.key]);

        patch(place.key, () => ({
          run: { kind: "failed", exitCode: null, output: appended(output, error.message) },
        }));
        void refreshGit(place.key, place.hostKey, place.root);
      },
    }
  );
};
