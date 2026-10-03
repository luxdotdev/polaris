/** Desktop App Update state comes from main; no renderer polling or success toast. */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PolarisApi, Result } from "../../../../shared/api.ts";
import type { AppUpdateView } from "../../../../shared/appUpdates.ts";
import { polaris } from "../../bridge.ts";

interface UpdatesState {
  readonly view: AppUpdateView | null;
  readonly problem: string | null;
  readonly changing: boolean;
}

export const updatesStore = createStore<UpdatesState>(() => ({
  view: null,
  problem: null,
  changing: false,
}));

export const useUpdates = <A>(select: (state: UpdatesState) => A): A =>
  useStore(updatesStore, select);

let revision = 0;

const applySnapshot = (result: Result<AppUpdateView>, expected: number) => {
  if (revision !== expected) return;

  if (result.ok) {
    revision += 1;
    updatesStore.setState({ view: result.value, problem: null });
  } else updatesStore.setState({ problem: result.error.message });
};

export const connectUpdates = (api: PolarisApi) => {
  const expected = revision;

  const stop = api.onAppEvent((event) => {
    if (event.kind === "updates") {
      revision += 1;
      updatesStore.setState({ view: event.updates, problem: null });
    }
  });

  void api.request("updates.get", {}).then((result) => {
    applySnapshot(result, expected);
  });

  return stop;
};

export const checkForUpdates = async () => {
  const expected = revision;

  updatesStore.setState({ problem: null });
  const result = await polaris().request("updates.check", {});

  applySnapshot(result, expected);
};

export const setAutomaticUpdates = async (enabled: boolean) => {
  if (updatesStore.getState().changing) return;
  const expected = revision;

  updatesStore.setState({ changing: true, problem: null });
  const result = await polaris().request("updates.setAutomatic", { enabled });
  applySnapshot(result, expected);
  updatesStore.setState({ changing: false });
};

export const restartToUpdate = async () => {
  const result = await polaris().request("updates.restart", {});

  if (!result.ok) updatesStore.setState({ problem: result.error.message });
};

export const showUpdateInFinder = async () => {
  const result = await polaris().request("updates.showInFinder", {});

  if (!result.ok) updatesStore.setState({ problem: result.error.message });
};
