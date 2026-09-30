/**
 * A Host's expanded row: the approval card (Paper 5FB-1) or the one inline
 * card for what needs the user (5PM-1), its Harnesses, and its settings.
 * Never a modal (DESIGN.md, Settings · Hosts).
 */
import { Button, Input, Switch } from "@polaris/ui";
import { useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { call } from "./hooks.tsx";
import { Harnesses } from "./Harnesses.tsx";
import {
  type CardAction,
  type CardButton,
  attentionCard,
  offerFacts,
  outcomeNote,
} from "./model.ts";
import { HostStateCard, InstallCard } from "./ui/cards.tsx";

export const DEFAULT_REMOTE_COMMAND = "~/.polaris/bin/current/polaris bridge";

const runAction = (machine: MachineView, action: CardAction, detail: string | null) => {
  const hostKey = machine.key;

  switch (action) {
    case "open-ssh":
      return call("machines.openSsh", { hostKey });
    case "retry":
      return call("host.retryNow", { hostKey });
    case "check":
      return call("machines.check", { hostKey });
    case "start-daemon":
      return call("machines.startDaemon", { hostKey });
    case "copy-detail":
      return detail === null ? null : call("clipboard.write", { text: detail });
    case "approve":
      return machine.install?.offer == null
        ? null
        : call("machines.approve", { hostKey, sha256: machine.install.offer.sha256 });
    case "dismiss":
      return call("machines.dismiss", { hostKey });
  }
};

const Approval = ({ machine }: { readonly machine: MachineView }) => {
  const facts = offerFacts(machine);

  if (facts === null) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-heading-sm text-text-strong">Install Polaris on {machine.label}?</p>
      <p className="text-body text-text-default">
        Connected over SSH. No Polaris daemon is running there yet.
      </p>
      <InstallCard
        className="w-full"
        data-testid="install-approval"
        facts={facts}
        note="Copied from this Mac, nothing downloaded. Asked once; upgrades install on their own."
        actions={
          <>
            <Button onClick={() => void runAction(machine, "dismiss", null)}>Not now</Button>
            <Button variant="primary" onClick={() => void runAction(machine, "approve", null)}>
              Approve and install
            </Button>
          </>
        }
      />
    </div>
  );
};

const bind = (machine: MachineView, button: CardButton | null, detail: string | null) =>
  button === null
    ? undefined
    : { label: button.label, onAction: () => void runAction(machine, button.action, detail) };

const Attention = ({ machine }: { readonly machine: MachineView }) => {
  const model = attentionCard(machine);

  if (model === null) return null;
  const busy = model.reason === "checking" || model.reason === "installing";

  return (
    <HostStateCard
      data-testid="attention-card"
      reason={model.reason}
      title={model.title}
      body={busy ? "" : model.body}
      detail={model.detail ?? undefined}
      fix={bind(machine, model.fix, model.detail)}
      secondary={bind(machine, model.secondary, model.detail)}
      progress={busy ? { label: model.body } : undefined}
    />
  );
};

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
            <p key={line} className="text-caption text-text-faint">
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
