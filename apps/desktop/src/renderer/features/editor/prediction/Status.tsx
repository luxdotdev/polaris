import { PixelPolarisIcon } from "@polaris/ui";
import { useEffect, useRef, useState } from "react";
import { useApp, useCommands } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { modelName, turnOnDiscoveredServer, usePrediction, type PredictionState } from "./store.ts";

interface Caption {
  /** The status bar's short label. */
  readonly label: string;
  /** The full state, for the tooltip. */
  readonly detail: string;
}

const on = (detail: string): Caption => ({ label: "Completions", detail });

const off = (detail: string): Caption => ({ label: "Completions off", detail });

const unavailable = (detail: string): Caption => ({ label: "Completions unavailable", detail });

const caption = (
  connection: string | undefined,
  hostKey: string,
  state: PredictionState,
  offer: boolean
): Caption => {
  const result = state.results[hostKey];
  const inspection = state.inspections[hostKey];

  if (connection === "reconnecting") return unavailable("Tab completion: Host reconnecting");

  if (connection !== "connected") return unavailable("Tab completion: Host offline");

  if (offer) {
    const text = "Model server found · Turn on tab completion";

    return { label: text, detail: text };
  }

  if (!state.enabled || state.preferences[hostKey]?.placement === "off")
    return off("Tab completion: Off");

  if (state.failures[hostKey]) return unavailable("Tab completion: Unavailable");

  if (result)
    return on(
      `Tab completion: ${modelName(result.model)} on ${result.machine} · ${Math.round(result.elapsedMs)} ms`
    );

  if (!inspection) return on("Tab completion: Finding model server…");

  const found = [...inspection.client.endpoints, ...(inspection.host?.endpoints ?? [])].some(
    (endpoint) => endpoint.models.length > 0
  );

  return found ? on("Tab completion: Ready") : unavailable("Tab completion: No model server found");
};

export const PredictionStatus = ({ hostKey }: { readonly hostKey: string }) => {
  const host = useApp((state) => state.hosts.find((item) => item.key === hostKey));
  const state = usePrediction((value) => value);
  const commands = useCommands();
  const acknowledged = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inspection = state.inspections[hostKey];

  const offer =
    host?.status.state === "connected" && !state.configured && inspection?.offer === true;

  useEffect(() => {
    if (!offer || acknowledged.current) return;
    acknowledged.current = true;
    void polaris().request("prediction.discoveryShown", {});
  }, [offer]);
  const result = state.results[hostKey];
  const { label, detail } = caption(host?.status.state, hostKey, state, offer);
  const serving = result !== undefined && state.enabled;

  const run = () => {
    if (!offer) {
      commands.runAny("settings.editor");

      return;
    }

    setPending(true);
    setError(null);

    void turnOnDiscoveredServer(polaris(), hostKey).then(
      () => setPending(false),
      (cause) => {
        setError(String(cause));
        setPending(false);
      }
    );
  };

  return (
    <button
      type="button"
      data-testid="prediction-status"
      disabled={pending}
      onClick={run}
      title={error ?? state.failures[hostKey] ?? detail}
      className="text-caption text-text-subtle hover:text-text-default flex min-w-0 cursor-default items-center gap-1.5 truncate rounded-sm"
    >
      <PixelPolarisIcon
        aria-hidden
        size={12}
        className={serving ? "shrink-0" : "shrink-0 opacity-50"}
      />
      <span className="truncate">{error ?? label}</span>
    </button>
  );
};
