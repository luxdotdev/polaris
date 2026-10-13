import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { PredictionPreferences } from "../../../shared/predictionPlacement.ts";
import { PredictionPlacementChoice } from "../../../shared/predictionPlacement.ts";
import { Option, Schema } from "effect";
import { polaris } from "../bridge.ts";
import { call } from "./hooks.tsx";

const choices = [
  { value: "auto", label: "Auto" },
  { value: "client", label: "This machine" },
  { value: "host", label: "Host" },
  { value: "off", label: "Off" },
] as const;

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

  const change = async (value: string) => {
    const placement = Schema.decodeUnknownOption(PredictionPlacementChoice)(value);

    if (preferences === null || saving || Option.isNone(placement)) return;
    setSaving(true);

    try {
      const saved = await call("prediction.settings.set", {
        hostKey,
        preferences: { ...preferences, placement: placement.value },
      });

      if (saved !== null) setPreferences(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="prediction-placement">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-label text-text-default">Run tab completion on</span>
          <span className="text-caption text-text-subtle">
            Auto chooses the stronger machine with a local model server.
          </span>
        </div>
        <Select
          value={preferences?.placement ?? "auto"}
          disabled={preferences === null || saving}
          onValueChange={(value) => void change(value)}
        >
          <SelectTrigger aria-label="Run tab completion on" className="text-label h-7 w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {resources !== null && resources.processes > 0 ? (
        <p className="text-caption text-text-subtle" data-testid="model-server-memory">
          Model servers on this machine · {Math.round(resources.rssBytes / 1024 ** 2)} MiB RSS ·
          outside the Desktop App budget
        </p>
      ) : null}
    </div>
  );
};
