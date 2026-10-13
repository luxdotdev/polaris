import { useEffect, useRef, useState } from "react";
import { useApp, useCommands } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { modelName, turnOnDiscoveredServer, usePrediction, type PredictionState } from "./store.ts";

const caption = (
  connection: string | undefined,
  hostKey: string,
  state: PredictionState,
  offer: boolean
) => {
  const result = state.results[hostKey];
  const inspection = state.inspections[hostKey];

  if (connection === "reconnecting") return "Tab completion: Host reconnecting";

  if (connection !== "connected") return "Tab completion: Host offline";

  if (offer) return "Model server found · Turn on tab completion";

  if (!state.enabled || state.preferences[hostKey]?.placement === "off")
    return "Tab completion: Off";

  if (state.failures[hostKey]) return "Tab completion: Unavailable";

  if (result)
    return `Tab completion: ${modelName(result.model)} on ${result.machine} · ${Math.round(result.elapsedMs)} ms`;

  if (!inspection) return "Tab completion: Finding model server…";

  const found = [...inspection.client.endpoints, ...(inspection.host?.endpoints ?? [])].some(
    (endpoint) => endpoint.models.length > 0
  );

  return found ? "Tab completion: Ready" : "Tab completion: No model server found";
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
  const text = caption(host?.status.state, hostKey, state, offer);

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
      title={error ?? state.failures[hostKey] ?? text}
      className="text-caption text-text-subtle hover:text-text-default flex min-w-0 cursor-default items-center gap-1.5 truncate rounded-sm"
    >
      <span
        aria-hidden
        className={
          result && state.enabled
            ? "bg-text-subtle size-1 shrink-0 rounded-full"
            : "border-text-subtle size-1 shrink-0 rounded-full border"
        }
      />
      <span className="truncate">{error ?? text}</span>
    </button>
  );
};
