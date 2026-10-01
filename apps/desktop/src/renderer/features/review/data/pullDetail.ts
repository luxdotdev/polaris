/**
 * A pull request's detail from GitHub (`github.pull.detail`: title, refs, files with their
 * Viewed state, threads, the pending review), shared by everything in its Review: the
 * header, the file list, and the comments and submit dialog that plug in (M2-F).
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { IpcError, OpenPull } from "../../../../shared/api.ts";
import type { PullDetailView } from "../../../../shared/github.ts";
import { polaris } from "../../bridge.ts";
import { settlePull } from "./viewedStore.ts";

export type PullDetail =
  | { readonly kind: "loading" }
  | { readonly kind: "ok"; readonly detail: PullDetailView }
  | { readonly kind: "failed"; readonly error: IpcError };

const details = createStore<Readonly<Record<string, PullDetail>>>(() => ({}));

export const pullKey = (pull: Pick<OpenPull, "repo" | "number">) =>
  `${pull.repo.owner}/${pull.repo.name}#${pull.number}`.toLowerCase();

/** Fetches the detail again (after a comment, a submit, or new commits); keeps the last while it loads. */
export const refreshPullDetail = async (pull: Pick<OpenPull, "repo" | "number">) => {
  const key = pullKey(pull);

  const result = await polaris().request("github.pull.detail", {
    pull: { repo: pull.repo, number: pull.number },
  });

  if (result.ok) {
    const detail = result.value;
    const viewed = new Map(detail.files.map((f) => [f.path, f.viewed === "viewed"]));

    settlePull(detail.id, (path) => viewed.get(path) ?? false);
    details.setState({ [key]: { kind: "ok", detail } });
  } else if (details.getState()[key]?.kind !== "ok") {
    details.setState({ [key]: { kind: "failed", error: result.error } });
  }
};

/** The pull request's detail, fetched when first asked for. */
export const usePullDetail = (pull: Pick<OpenPull, "repo" | "number">): PullDetail => {
  const current = useStore(details, (s) => s[pullKey(pull)]);
  const { owner, name } = pull.repo;
  const { number } = pull;

  useEffect(() => {
    void refreshPullDetail({ repo: { owner, name }, number });
  }, [owner, name, number]);

  return current ?? { kind: "loading" };
};
