/** The machines feed, requests with toasts on failure, and a clock for elapsed times. */
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { useEffect, useState } from "react";
import type {
  InstallFlowView,
  MachineView,
  RequestInput,
  RequestMethod,
  RequestOutput,
} from "../../../shared/api.ts";

/** Every machine for Settings, live; null until the first list arrives. */
export const useMachines = (): ReadonlyArray<MachineView> | null => {
  const [machines, setMachines] = useState<ReadonlyArray<MachineView> | null>(null);

  useEffect(
    () =>
      window.polaris.subscribe(
        "machines",
        {},
        { items: (lists) => setMachines(lists.at(-1) ?? null) }
      ),
    []
  );

  return machines;
};

/** Calls the main process; a failure becomes a toast and resolves to null. */
export const call = async <M extends RequestMethod>(
  method: M,
  input: RequestInput<M>
): Promise<RequestOutput<M> | null> => {
  const result = await window.polaris.request(method, input);

  if (result.ok) return result.value;
  showToast({
    source: "starlight",
    icon: <PixelFailedIcon />,
    title: "That didn't work",
    message: result.error.message,
  });

  return null;
};

/** The current time, ticking every second while `live`; still otherwise (idle costs nothing). */
export const useNow = (live: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [live]);

  return live ? now : Date.now();
};

/** One Host's install flow, live, only while `enabled` (no feed otherwise). */
export const useMachineInstall = (key: string, enabled: boolean): InstallFlowView | null => {
  const [install, setInstall] = useState<InstallFlowView | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    return window.polaris.subscribe(
      "machines",
      {},
      {
        items: (lists) => setInstall(lists.at(-1)?.find((m) => m.key === key)?.install ?? null),
      }
    );
  }, [key, enabled]);

  return enabled ? install : null;
};
