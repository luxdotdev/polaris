import { type SettingsOption, SettingsSelectRow } from "@polaris/ui";
import { useEffect, useState } from "react";
import type {
  PredictionPlacementChoice,
  PredictionPreferences,
} from "../../../shared/predictionPlacement.ts";
import { polaris } from "../bridge.ts";
import { call } from "./hooks.tsx";

const choices: ReadonlyArray<SettingsOption<PredictionPlacementChoice>> = [
  { value: "auto", label: "Auto" },
  { value: "client", label: "This machine" },
  { value: "host", label: "Host" },
  { value: "off", label: "Off" },
];

/** Per-Host setting, editable even while the Host is Offline. */
export const PredictionPlacement = ({ hostKey }: { readonly hostKey: string }) => {
  const [preferences, setPreferences] = useState<PredictionPreferences | null>(null);

  const [resources, setResources] = useState<{
    readonly rssBytes: number;
    readonly processes: number;
  } | null>(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setPreferences(null);
    void polaris()
      .request("prediction.settings.get", { hostKey })
      .then((result) => {
        if (active && result.ok) setPreferences(result.value);
      });

    void polaris()
      .request("prediction.resources.get", {})
      .then((result) => {
        if (active && result.ok) setResources(result.value);
      });

    return () => {
      active = false;
    };
  }, [hostKey]);

  const change = async (placement: PredictionPlacementChoice) => {
    if (preferences === null || saving) return;
    setSaving(true);

    try {
      const saved = await call("prediction.settings.set", {
        hostKey,
        preferences: { ...preferences, placement },
      });

      if (saved !== null) setPreferences(saved);
    } finally {
      setSaving(false);
    }
  };

  const memory =
    resources !== null && resources.processes > 0
      ? ` · Model servers here use ${Math.round(resources.rssBytes / 1024 ** 2)} MiB`
      : "";

  return (
    <div data-testid="prediction-placement">
      <SettingsSelectRow
        title="Run tab completion on"
        caption={`Auto chooses the stronger machine with a local model server${memory}`}
        value={preferences?.placement ?? "auto"}
        options={choices}
        disabled={preferences === null || saving}
        onChange={(value) => void change(value)}
      />
    </div>
  );
};
