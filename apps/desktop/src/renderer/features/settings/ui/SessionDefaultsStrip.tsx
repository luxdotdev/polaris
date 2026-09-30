/**
 * A Harness group's footer strip: what new sessions start with (Model, effort,
 * permissions). Saved in settings and read by the new-session page through
 * `useSessionDefault`. Models come from `harness.models` on a Host where the
 * Harness is ready.
 */
import type { Model, PermissionMode } from "@polaris/protocol";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { Plain, SessionDefault } from "../../../../shared/api.ts";
import { setSessionDefault, useSessionDefault } from "../store.ts";
import { FooterStrip } from "./parts.tsx";

type ModelData = Plain<Model>;

/** The Select value meaning "the Harness's own default" (null). */
const DEFAULT = "default";

const PERMISSIONS: ReadonlyArray<{ readonly mode: PermissionMode; readonly label: string }> = [
  { mode: "supervised", label: "Supervised" },
  { mode: "auto-edits", label: "Auto edits" },
  { mode: "auto", label: "Auto" },
  { mode: "full-access", label: "Full access" },
];

const useModels = (hostKey: string | null, harness: string): ReadonlyArray<ModelData> => {
  const [models, setModels] = useState<{ key: string; list: ReadonlyArray<ModelData> } | null>(
    null
  );

  const key = `${hostKey ?? ""}\u0000${harness}`;

  useEffect(() => {
    if (hostKey === null) return undefined;
    let live = true;

    void window.polaris
      .request("harness.models", { hostKey, harness, refresh: false })
      .then((result) => {
        if (live && result.ok) setModels({ key, list: result.value.models });
      });

    return () => {
      live = false;
    };
  }, [hostKey, harness, key]);

  // Claude Code's `default` row means "whatever it picks": that is our Default already.
  return (models?.key === key ? models.list : []).filter((m) => m.id !== DEFAULT);
};

const Chip = ({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly disabled?: boolean;
}) => (
  <Select value={value} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger aria-label={label} className="px-gap h-[26px] gap-1.5 bg-transparent">
      <span className="text-caption text-text-subtle">{label}</span>
      <span className="text-body text-text-default font-medium">
        <SelectValue />
      </span>
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const NONE: SessionDefault = { model: null, effort: null, permissionMode: "supervised" };

export const SessionDefaultsStrip = ({
  harness,
  modelHost,
}: {
  readonly harness: string;
  /** A Host where the Harness is ready, to list its Models; null leaves Default only. */
  readonly modelHost: string | null;
}) => {
  const current = useSessionDefault(harness) ?? NONE;
  const models = useModels(modelHost, harness);
  const model = models.find((m) => m.id === current.model);
  const efforts = model?.efforts ?? [];

  const save = (patch: Partial<SessionDefault>) =>
    setSessionDefault(harness, { ...current, ...patch });

  const modelOptions = [
    { value: DEFAULT, label: "Default" },
    ...models.map((m) => ({ value: m.id, label: m.name })),
    // A saved Model this Host doesn't list stays shown by its id.
    ...(current.model !== null && model === undefined
      ? [{ value: current.model, label: current.model }]
      : []),
  ];

  return (
    <FooterStrip>
      <span className="text-caption text-text-subtle w-[146px] shrink-0">
        New sessions start with
      </span>
      <Chip
        label="Model"
        value={current.model ?? DEFAULT}
        options={modelOptions}
        onChange={(v) => {
          const next = models.find((m) => m.id === v);

          save({ model: v === DEFAULT ? null : v, effort: next?.defaultEffort ?? null });
        }}
      />
      <Chip
        label="Effort"
        value={current.effort ?? DEFAULT}
        disabled={efforts.length === 0}
        options={[
          { value: DEFAULT, label: "Default" },
          ...efforts.map((e) => ({ value: e, label: e })),
        ]}
        onChange={(v) => save({ effort: v === DEFAULT ? null : v })}
      />
      <Chip
        label="Permissions"
        value={current.permissionMode}
        options={PERMISSIONS.map((p) => ({ value: p.mode, label: p.label }))}
        onChange={(v) => {
          const permission = PERMISSIONS.find((p) => p.mode === v);

          if (permission !== undefined) save({ permissionMode: permission.mode });
        }}
      />
    </FooterStrip>
  );
};
