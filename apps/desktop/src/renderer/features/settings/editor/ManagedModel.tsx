/**
 * Settings → Editor → Tab completion → Model (DESIGN.md, Tab completion setup): the one model
 * Polaris downloads and runs on the chosen machine, the folder it lives in, and what it's doing.
 */
import { Button, Input } from "@polaris/ui";
import { ManagedModelId, type ManagedServerStatus } from "@polaris/protocol";
import { Match, Option, Schema } from "effect";
import { useEffect, useState } from "react";
import type { PredictionSide } from "@polaris/client/prediction";
import { polaris } from "../../bridge.ts";
import { FAILURE_TITLES, gb } from "../../editor/prediction/card/managed.ts";
import {
  managedAction,
  managedKey,
  preferencesOf,
  setHostPreferences,
  usePrediction,
  watchManaged,
} from "../../editor/prediction/store.ts";
import { FooterStrip, Group, SettingRow } from "../ui/parts.tsx";

const CONTROL =
  "bg-surface-sunken border-hairline rounded-control text-body text-text-default h-row min-w-0 border px-row-pad";

const SWEEP = "sweep-next-edit-1.5b";

const CHOICES: ReadonlyArray<{ readonly id: ManagedModelId; readonly label: string }> = [
  { id: SWEEP, label: "Sweep Next-Edit 1.5B · 2.6 GB of memory · recommended" },
  { id: "zeta-2.1", label: "Zeta 2.1 · higher quality · about 9 GB of memory" },
];

export interface ManagedModelProps {
  /** The preferences key of the machine: the local Host's for the Client side, else the Host's. */
  readonly hostKey: string;
  readonly side: PredictionSide;
  readonly machine: string;
  readonly connected: boolean;
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** One line for the status row, and which buttons follow it. */
const describe = (status: ManagedServerStatus, machine: string) =>
  Match.value(status.phase).pipe(
    Match.tag("Unsupported", (phase) => ({
      line:
        phase.reason === "too-small"
          ? `${machine} is too small to run a next-edit model`
          : `No model server build for ${machine}`,
      primary: null,
      remove: false,
      cancel: false,
    })),
    Match.tag("Absent", () => ({
      line: `Not downloaded · ${gb(status.model.sizeBytes + status.model.serverBytes)} download${status.freeBytes === null ? "" : ` · ${gb(status.freeBytes)} free`}`,
      primary: `Download ${status.model.name}`,
      remove: false,
      cancel: false,
    })),
    Match.tag("Downloading", (phase) => ({
      line: `Downloading ${phase.file === "server" ? "the model server" : status.model.name} · ${mb(phase.receivedBytes)} of ${gb(phase.totalBytes)}`,
      primary: null,
      remove: false,
      cancel: true,
    })),
    Match.tag("Verifying", () => ({
      line: "Verifying the download against its published checksum",
      primary: null,
      remove: false,
      cancel: false,
    })),
    Match.tag("Stopped", () => ({
      line: "Downloaded · starts on the first keystroke, stops after 15 idle minutes",
      primary: null,
      remove: true,
      cancel: false,
    })),
    Match.tag("Starting", () => ({
      line: `Loading ${status.model.name}…`,
      primary: null,
      remove: true,
      cancel: false,
    })),
    Match.tag("Serving", () => ({
      line: `Running${status.memoryBytes === null ? "" : ` · ${gb(status.memoryBytes)} of memory`}`,
      primary: null,
      remove: true,
      cancel: false,
    })),
    Match.tag("Backoff", (phase) => ({
      line: `Stopped · restarting in ${Math.ceil(phase.retryInMs / 1000)} s`,
      primary: null,
      remove: true,
      cancel: false,
    })),
    Match.tag("Failed", (phase) => ({
      line:
        phase.message.length > 0
          ? `${FAILURE_TITLES[phase.reason]} · ${phase.message}`
          : FAILURE_TITLES[phase.reason],
      primary: "Try again",
      remove: true,
      cancel: false,
    })),
    Match.exhaustive
  );

const progressOf = (status: ManagedServerStatus) =>
  Match.value(status.phase).pipe(
    Match.tag("Downloading", (phase) =>
      phase.totalBytes === 0 ? 0 : phase.receivedBytes / phase.totalBytes
    ),
    Match.orElse(() => null)
  );

export const ManagedModel = ({ hostKey, side, machine, connected }: ManagedModelProps) => {
  const status = usePrediction(
    (state) =>
      state.managed[managedKey(hostKey, side)] ?? state.inspections[hostKey]?.managed[side] ?? null
  );

  const preferences =
    usePrediction((state) => state.preferences[hostKey]) ?? preferencesOf(hostKey);

  const [folder, setFolder] = useState(preferences.modelsDir ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;

    return watchManaged(polaris(), hostKey, side);
  }, [hostKey, side, connected]);

  useEffect(() => setFolder(preferences.modelsDir ?? ""), [preferences.modelsDir]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);

    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const act = (action: "setup" | "cancel" | "remove") =>
    run(async () => {
      await managedAction(polaris(), hostKey, side, action);
    });

  const saveFolder = (value: string) => {
    const modelsDir = value.trim() === "" ? null : value.trim();

    if (modelsDir === preferences.modelsDir) return;

    void run(async () => {
      await setHostPreferences(polaris(), hostKey, { modelsDir });
      await managedAction(polaris(), hostKey, side, null);
    });
  };

  const choose = () =>
    run(async () => {
      const result = await polaris().request("prediction.modelsDir.choose", {});

      if (result.ok && result.value !== null) {
        setFolder(result.value);
        saveFolder(result.value);
      }
    });

  const chooseModel = (value: string) => {
    const model = Schema.decodeUnknownOption(ManagedModelId)(value);

    void run(async () => {
      await setHostPreferences(polaris(), hostKey, {
        managedModel: Option.isSome(model) && model.value !== SWEEP ? model.value : null,
      });
      await managedAction(polaris(), hostKey, side, null);
    });
  };

  const described = status === null ? null : describe(status, machine);
  const progress = status === null ? null : progressOf(status);

  const folderCaption =
    status === null
      ? `On ${machine}`
      : `${status.modelsDir}${status.freeBytes === null ? "" : ` · ${gb(status.freeBytes)} free`}`;

  return (
    <Group label={`Model on ${machine}`} className="mt-1">
      <SettingRow
        htmlFor={`managed-model-${hostKey}`}
        title="Model"
        caption="One next-edit model, downloaded from its publisher and run by Polaris on this machine. It also completes plain insertions."
      >
        <select
          id={`managed-model-${hostKey}`}
          value={preferences.managedModel ?? SWEEP}
          disabled={busy || !connected}
          onChange={(event) => chooseModel(event.target.value)}
          className={`${CONTROL} max-w-80`}
        >
          {CHOICES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow htmlFor={`models-dir-${hostKey}`} title="Model folder" caption={folderCaption}>
        <Input
          id={`models-dir-${hostKey}`}
          value={folder}
          placeholder="~/.polaris/models"
          spellCheck={false}
          className="w-64 font-mono"
          disabled={busy || !connected}
          onChange={(event) => setFolder(event.target.value)}
          onBlur={(event) => saveFolder(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") saveFolder(folder);
          }}
        />
        {side === "client" && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !connected}
            onClick={() => void choose()}
          >
            Choose…
          </Button>
        )}
      </SettingRow>
      <FooterStrip>
        <span
          className="text-caption text-text-subtle min-w-0 flex-1 truncate"
          role="status"
          data-testid="managed-status"
          title={described?.line ?? undefined}
        >
          {!connected ? `${machine} is offline` : (described?.line ?? `Checking ${machine}…`)}
        </span>
        {progress !== null && (
          <div
            role="progressbar"
            aria-label="Download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(progress * 100)}
            className="bg-fill-selected h-[3px] w-40 shrink-0 overflow-hidden rounded-full"
          >
            <div
              className="bg-text-strong h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.max(2, Math.floor(progress * 100))}%` }}
            />
          </div>
        )}
        {described?.cancel === true && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act("cancel")}>
            Cancel
          </Button>
        )}
        {described?.remove === true && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act("remove")}>
            Remove downloaded model
          </Button>
        )}
        {described?.primary !== null && described !== undefined && described !== null && (
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !connected}
            onClick={() => void act("setup")}
          >
            {described.primary}
          </Button>
        )}
      </FooterStrip>
      {error !== null && (
        <FooterStrip>
          <span role="alert" className="text-caption text-text-strong">
            {error}
          </span>
        </FooterStrip>
      )}
    </Group>
  );
};
