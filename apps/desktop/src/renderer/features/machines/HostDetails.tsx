/**
 * A Host's expanded row: the approval card (Paper 5FB-1) or the one inline
 * card for what needs the user (5PM-1), its Harnesses, and its settings.
 * Never a modal (DESIGN.md, Settings · Hosts).
 */
import {
  Button,
  Dither,
  HostStateCard,
  type HostStateCardProps,
  InstallCard,
  Input,
  Switch,
} from "@polaris/ui";
import { useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { slots } from "../../app/slots.tsx";
import { useApp } from "../../shell/hooks.ts";
import { call } from "./hooks.tsx";
import { Harnesses } from "./Harnesses.tsx";
import {
  type CardAction,
  type CardButton,
  attentionCard,
  offerFacts,
  outcomeNote,
} from "./model.ts";

export const DEFAULT_REMOTE_COMMAND = "~/.polaris/bin/current/polaris bridge";

/** What a card's actions need beyond requests: where "Open in Terminal" runs. */
interface ActionContext {
  readonly openSsh: () => void;
}

const runAction = (
  machine: MachineView,
  action: CardAction,
  detail: string | null,
  context: ActionContext
) => {
  const hostKey = machine.key;

  switch (action) {
    case "open-ssh":
      return context.openSsh();
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

const NO_CONTEXT: ActionContext = { openSsh: () => undefined };

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
            <Button onClick={() => void runAction(machine, "dismiss", null, NO_CONTEXT)}>
              Not now
            </Button>
            <Button
              variant="primary"
              onClick={() => void runAction(machine, "approve", null, NO_CONTEXT)}
            >
              Approve and install
            </Button>
          </>
        }
      />
    </div>
  );
};

const bind = (
  machine: MachineView,
  button: CardButton,
  detail: string | null,
  context: ActionContext
) => ({
  label: button.label,
  onAction: () => void runAction(machine, button.action, detail, context),
});

type MutableCardProps = { -readonly [K in keyof HostStateCardProps]: HostStateCardProps[K] };

/** `@polaris/ui`'s HostStateCard for the row's card; checking and installing lead with the dither. */
const cardProps = (machine: MachineView, context: ActionContext): HostStateCardProps | null => {
  const model = attentionCard(machine);

  if (model === null) return null;
  const busy = model.reason === "checking" || model.reason === "installing";
  // The client reports steps, not bytes, so work in progress is the dither, never a guessed bar.

  const title = busy ? (
    <span className="flex items-center gap-2">
      <Dither hue="starlight" size={12} />
      {model.title}
    </span>
  ) : (
    model.title
  );

  const props: MutableCardProps = {
    reason: model.reason,
    title,
    body: model.body,
  };

  if (model.detail !== null) props.detail = model.detail;

  if (model.fix !== null) props.fix = bind(machine, model.fix, model.detail, context);

  if (model.secondary !== null)
    props.secondary = bind(machine, model.secondary, model.detail, context);

  return props;
};

/**
 * The row's card, and `ssh <alias>` in a terminal on this Mac's local Host
 * (to trust a host key) under it; macOS Terminal only when the local Host is off.
 */
const Attention = ({ machine }: { readonly machine: MachineView }) => {
  const localUp = useApp(
    (s) => s.hosts.find((h) => h.key === "local")?.status.state === "connected"
  );

  const [ssh, setSsh] = useState(false);

  const openSsh = () =>
    localUp ? setSsh(true) : void call("machines.openSsh", { hostKey: machine.key });

  const props = cardProps(machine, { openSsh });

  return (
    <>
      {props === null ? null : <HostStateCard data-testid="attention-card" {...props} />}
      {ssh && machine.alias !== null ? (
        <slots.HarnessTerminal
          hostKey="local"
          argv={["ssh", "--", machine.alias]}
          onExit={() => void call("host.retryNow", { hostKey: machine.key })}
          onClose={() => setSsh(false)}
        />
      ) : null}
    </>
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
