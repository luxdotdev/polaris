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
import { outcomeNote } from "./model.ts";

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

const RemoteSettings = ({ machine }: { readonly machine: MachineView }) => (
  <>
    <Field label="Name" caption="How this host appears across Polaris.">
      <TextSetting
        label="Name"
        value={machine.label}
        placeholder={machine.alias ?? ""}
        onSave={(label) => void call("machines.update", { hostKey: machine.key, label })}
      />
    </Field>
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
    <Field
      label="Remote command"
      caption="What ssh runs on the host. Empty for the installed daemon."
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
  </>
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
      {settings ? <Settings machine={machine} /> : null}
    </>
  );
};

const Settings = ({ machine }: { readonly machine: MachineView }) => {
  const local = machine.alias === null;

  return (
    <>
      <div className="border-hairline flex flex-col gap-3 border-t pt-3">
        {local ? (
          <Field
            label="Use this Mac as a host"
            caption="Off, Polaris only drives remote hosts from here and runs nothing on this Mac."
          >
            <Switch
              aria-label="Use this Mac as a host"
              checked={machine.enabled}
              onCheckedChange={(enabled) => void call("machines.setLocalEnabled", { enabled })}
            />
          </Field>
        ) : (
          <RemoteSettings machine={machine} />
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
