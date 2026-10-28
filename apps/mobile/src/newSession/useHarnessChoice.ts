/** The chosen Host's Harnesses and the chosen Harness's Models, loaded when the Host changes. */
import type { HarnessKind, Model } from "@polaris/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NewSessionApi } from "./api.ts";
import {
  defaultHarness,
  type HarnessOption,
  harnessOptions,
  type NotReadyHarness,
  notReadyHarnesses,
} from "./harness.ts";
import { failureText, lastUsedHarnesses, type SheetHost } from "./model.ts";

export type HarnessLoad =
  | { readonly kind: "loading" }
  | {
      readonly kind: "loaded";
      readonly options: ReadonlyArray<HarnessOption>;
      /** Each Harness that isn't ready, with its reason and its fix on the Host. */
      readonly notReady: ReadonlyArray<NotReadyHarness>;
    }
  | { readonly kind: "failed"; readonly message: string };

export interface HarnessChoice {
  readonly load: HarnessLoad;
  readonly harness: HarnessKind | null;
  readonly setHarness: (harness: HarnessKind) => void;
  /** The Harness's Models; empty until they arrive or when it won't say. */
  readonly models: ReadonlyArray<Model>;
  /** Null: the Harness's default. */
  readonly model: Model | null;
  readonly setModel: (model: Model | null) => void;
  /** Asks the Host to probe its Harnesses again ("Check again"). */
  readonly refresh: () => void;
}

export const useHarnessChoice = (api: NewSessionApi, host: SheetHost | null): HarnessChoice => {
  const [load, setLoad] = useState<HarnessLoad>({ kind: "loading" });
  const [harness, setHarnessState] = useState<HarnessKind | null>(null);
  const [models, setModels] = useState<ReadonlyArray<Model>>([]);
  const [model, setModel] = useState<Model | null>(null);
  // 0 reads the Daemon's cache; each "Check again" bumps it and asks for a fresh probe.
  const [probe, setProbe] = useState(0);
  const hostId = host?.hostId ?? null;
  const connected = host?.connected ?? false;
  // The Host's identity, not each feed update, decides when to ask again.
  const latestHost = useRef(host);

  latestHost.current = host;

  useEffect(() => {
    const host = latestHost.current;

    if (host === null || !connected) return;
    let live = true;

    setLoad({ kind: "loading" });

    const ask = async () => {
      try {
        const report = await api.availability(host.hostId, probe > 0);
        const options = harnessOptions(report);

        if (!live) return;
        setLoad({ kind: "loaded", options, notReady: notReadyHarnesses(report, host.hostName) });
        setHarnessState((chosen) =>
          chosen !== null && options.some((o) => o.kind === chosen && o.startable)
            ? chosen
            : defaultHarness(options, lastUsedHarnesses(host))
        );
      } catch (failure) {
        if (live) setLoad({ kind: "failed", message: failureText(failure) });
      }
    };

    void ask();

    return () => {
      live = false;
    };
  }, [api, hostId, connected, probe]);

  useEffect(() => {
    if (hostId === null || harness === null) return;
    let live = true;

    setModels([]);
    setModel(null);
    // A Harness that won't list its Models still starts on its default.
    void api
      .models(hostId, harness)
      .then((listed) => {
        if (live) setModels(listed.models);
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [api, hostId, harness]);

  const refresh = useCallback(() => setProbe((n) => n + 1), []);

  return { load, harness, setHarness: setHarnessState, models, model, setModel, refresh };
};
