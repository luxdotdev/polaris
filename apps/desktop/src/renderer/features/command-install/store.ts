import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { CommandInstallView, CommandLocation } from "../../../shared/commandInstall.ts";
import type { Result } from "../../../shared/api.ts";
import { polaris } from "../bridge.ts";

interface State {
  readonly view: CommandInstallView | null;
  readonly problem: string | null;
  readonly busy: boolean;
}

export const commandInstallStore = createStore<State>(() => ({
  view: null,
  problem: null,
  busy: false,
}));

let revision = 0;

export const useCommandInstall = () => useStore(commandInstallStore);

const receive = (result: Result<CommandInstallView>) => {
  if (result.ok) commandInstallStore.setState({ view: result.value, problem: null });
  else commandInstallStore.setState({ problem: result.error.message });
};

export const refreshCommandInstall = async () => {
  if (commandInstallStore.getState().busy) return;

  const expected = ++revision;

  try {
    const result = await polaris().request("commandInstall.get", {});

    if (revision === expected) receive(result);
  } catch {
    if (revision === expected)
      commandInstallStore.setState({ problem: "Couldn't read the command installation" });
  }
};

export const changeCommandInstall = async (
  action: "install" | "uninstall",
  location: CommandLocation
) => {
  if (commandInstallStore.getState().busy) return;
  revision += 1;
  commandInstallStore.setState({ busy: true, problem: null });

  try {
    receive(await polaris().request("commandInstall.change", { action, location }));
  } catch {
    commandInstallStore.setState({ problem: "Couldn't change the command installation" });
  } finally {
    commandInstallStore.setState({ busy: false });
  }
};

export const dismissCommandInstall = async () => {
  revision += 1;

  try {
    receive(await polaris().request("commandInstall.dismiss", {}));
  } catch {
    commandInstallStore.setState({ problem: "Couldn't dismiss the command offer" });
  }
};
