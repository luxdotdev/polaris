import { PredictionPlacement } from "./PredictionPlacement.tsx";
import { RelayRoute } from "./RelayRoute.tsx";
import { RemoteAccess } from "./RemoteAccess.tsx";
/**
 * A Host's expanded row: the approval (Paper 5FB-1's facts) or what needs the
 * user (S4), its Harnesses, and its settings, all flat in the row.
 * Never a modal (DESIGN.md, Settings · Hosts).
 */
import { Button, Input, Switch } from "@polaris/ui";
import { useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { Approval, Attention } from "./Attention.tsx";
import { call } from "./hooks.tsx";
import { Harnesses } from "./Harnesses.tsx";
import { HostResources } from "../settings/ui/HostResources.tsx";
import { outcomeNote } from "./model.ts";
import { setDaemonUpdateOverride } from "./updates/actions.ts";
import { OverrideSelect } from "./updates/Controls.tsx";
import { clientCopy } from "../../../shared/clientCopy.ts";

export const DEFAULT_REMOTE_COMMAND = "~/.polaris/bin/current/polaris bridge";

interface FieldProps {
  readonly label: string;
  readonly caption: string;
  readonly children: React.ReactNode;
}

const Field = ({ label, caption, children }: FieldProps) => (
  <div className="flex items-center gap-3">
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-label text-text-default">{label}</span>
      <span className="text-caption text-text-subtle">{caption}</span>
    </div>
    {children}
  </div>
);

/** A text setting saved on Enter or blur. */
const TextSetting = ({
  value,
  placeholder,
  label,
  onSave,
  mono = false,
}: {
  readonly value: string;
  readonly placeholder: string;
  readonly label: string;
  readonly onSave: (value: string) => void;
  readonly mono?: boolean;
}) => {
  const [draft, setDraft] = useState(value);

  const save = () => {
    if (draft.trim() !== value) onSave(draft.trim());
  };

  return (
    <Input
      aria-label={label}
      className={mono ? "text-code-inline w-[260px] font-mono" : "w-[260px]"}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
      }}
    />
  );
};

export const RemoteSettings = ({ machine }: { readonly machine: MachineView }) => (
  <>
    <Field label="Name" caption="How this host appears across Polaris.">
      <TextSetting
        label="Name"
        value={machine.label}
        placeholder={machine.alias ?? ""}
        onSave={(label) => void call("machines.update", { hostKey: machine.key, label })}
      />
    </Field>
    {machine.kind === "wsl" ? null : (
      <Field
        label="Forward ssh-agent"
        caption="Agents on this host can use your keys, for git over SSH. Off unless you need it."
      >
        <Switch
          aria-label="Forward ssh-agent"
          checked={machine.forwardAgent}
          onCheckedChange={(forwardAgent) =>
            void call("machines.update", { hostKey: machine.key, forwardAgent })
          }
        />
      </Field>
    )}
    {machine.windowsShell === undefined ? (
      <RemoteCommand machine={machine} />
    ) : (
      <Field label="Remote command" caption={WINDOWS_REMOTE_COMMAND}>
        {null}
      </Field>
    )}
  </>
);

/** Why a Windows Host has no remote command to set: its connection is always the relay. */
export const WINDOWS_REMOTE_COMMAND =
  "Windows hosts always connect through PowerShell to the installed daemon.";

/** A WSL Host's remote command runs through wsl.exe, not ssh. */
export const WSL_REMOTE_COMMAND =
  "What wsl.exe runs in the distro. Empty for the installed daemon.";

const RemoteCommand = ({ machine }: { readonly machine: MachineView }) => (
  <Field
    label="Remote command"
    caption={
      machine.kind === "wsl"
        ? WSL_REMOTE_COMMAND
        : "What ssh runs on the host. Empty for the installed daemon."
    }
  >
    <TextSetting
      label="Remote command"
      value={machine.remoteCommand ?? ""}
      placeholder={DEFAULT_REMOTE_COMMAND}
      mono
      onSave={(line) =>
        void call("machines.update", {
          hostKey: machine.key,
          remoteCommand: line === "" ? null : line,
        })
      }
    />
  </Field>
);

export interface HostDetailsProps {
  readonly machine: MachineView;
  /** The user opened the row: show its settings too, not only what needs them. */
  readonly settings: boolean;
}

export const HostDetails = ({ machine, settings }: HostDetailsProps) => {
  const note = outcomeNote(machine);

  return (
    <>
      {machine.install?.step === "approval" ? (
        <Approval machine={machine} />
      ) : (
        <Attention machine={machine} />
      )}
      {note === null ? null : (
        <div className="flex flex-col gap-0.5" data-testid="install-outcome">
          <p className="text-caption text-text-subtle">{note}</p>
          {(machine.install?.outcome?.notes ?? []).map((line) => (
            <p key={line} className="text-caption text-text-subtle">
              {line}
            </p>
          ))}
        </div>
      )}
      {machine.status?.state === "connected" ? <Harnesses machine={machine} /> : null}
      {settings && machine.status?.state === "connected" ? (
        <HostResources hostKey={machine.key} />
      ) : null}
      {settings ? <Settings machine={machine} /> : null}
    </>
  );
};

/** How other devices reach the host (Paper D2, D2b): each route stays off until turned on. */
const Routes = ({
  machine,
  capabilities,
}: {
  readonly machine: MachineView;
  readonly capabilities: ReadonlyArray<string>;
}) => {
  const relay = capabilities.includes("linked-devices");
  const tailscale = capabilities.includes("remote-access");

  if (!relay && !tailscale) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-label text-text-strong font-medium">Remote access</span>
        <span className="text-caption text-text-subtle">
          How your other devices reach {machine.label}. Each route stays off until you turn it on.
        </span>
      </div>
      <div className="bg-surface-sunken rounded-card px-panel divide-hairline flex flex-col divide-y">
        {relay ? (
          <div className="py-3">
            <RelayRoute hostKey={machine.key} hostLabel={machine.label} />
          </div>
        ) : null}
        {tailscale ? (
          <div className="py-3">
            <RemoteAccess hostKey={machine.key} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

const Settings = ({ machine }: { readonly machine: MachineView }) => {
  const local = machine.alias === null;

  return (
    <>
      <div className="border-hairline flex flex-col gap-3 border-t pt-3">
        <PredictionPlacement hostKey={machine.key} />
        {machine.status?.state === "connected" ? (
          <Routes machine={machine} capabilities={machine.status.capabilities} />
        ) : null}
        {local ? (
          <Field
            label={`Use ${clientCopy().machine} as a host`}
            caption={`Off, Polaris only drives remote hosts from here and runs nothing on ${clientCopy().machine}.`}
          >
            <Switch
              aria-label={`Use ${clientCopy().machine} as a host`}
              checked={machine.enabled}
              onCheckedChange={(enabled) => void call("machines.setLocalEnabled", { enabled })}
            />
          </Field>
        ) : (
          <RemoteSettings machine={machine} />
        )}
        {machine.daemon === null || !machine.daemon.managed ? null : (
          <Field
            label="Daemon upgrades"
            caption="Whether this host's daemon upgrades on its own when it connects."
          >
            <OverrideSelect
              daemon={machine.daemon}
              onChange={(enabled) => setDaemonUpdateOverride(machine.key, enabled)}
            />
          </Field>
        )}
      </div>
      {local ? null : (
        <div className="flex gap-2">
          <Button onClick={() => void call("host.retryNow", { hostKey: machine.key })}>
            Retry now
          </Button>
          <Button
            variant="danger"
            onClick={() => void call("machines.remove", { hostKey: machine.key })}
          >
            Remove host
          </Button>
        </div>
      )}
    </>
  );
};
