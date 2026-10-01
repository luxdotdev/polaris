/** The update requests: `machines.updateDaemon` and the two switches. */
import { call } from "../hooks.tsx";

export const updateDaemon = (hostKey: string) => void call("machines.updateDaemon", { hostKey });

export const setKeepDaemonsUpToDate = (enabled: boolean) =>
  void call("machines.setKeepDaemonsUpToDate", { enabled });

export const setDaemonUpdateOverride = (hostKey: string, enabled: boolean | null) =>
  void call("machines.setDaemonUpdateOverride", { hostKey, enabled });
