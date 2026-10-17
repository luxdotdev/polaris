/**
 * What a Host's row says when it needs the user, flat inside the row as in
 * Paper S4 (7CV-1): what happened in one sentence, the evidence in a sunken
 * well, and its actions, all secondary: "Add a host" is the page's one
 * primary button (DESIGN.md, Settings · Hosts; Buttons). Never a modal.
 */
import { Button, CopyButton, Dither, InstallWell, Kbd } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { slots } from "../../app/slots.tsx";
import { useApp } from "../../shell/hooks.ts";
import { call } from "./hooks.tsx";
import {
  type CardAction,
  type CardButton,
  type CardModel,
  attentionCard,
  offerFacts,
  takeOverConfirmation,
} from "./model.ts";
import { modKey, shortcutLabel } from "../../../shared/chord.ts";
import { FIELD_CHORDS } from "../../../shared/keymap.ts";
import { clientCopy } from "../../../shared/clientCopy.ts";

/** What an action needs beyond requests: where "Open in terminal" runs. */
interface ActionContext {
  readonly openSsh: () => void;
}

const runAction = (machine: MachineView, action: CardAction, context: ActionContext) => {
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
      // A CopyButton writes and says so itself (`ActionButton`).
      return null;
    case "approve":
      return machine.install?.offer == null
        ? null
        : call("machines.approve", { hostKey, sha256: machine.install.offer.sha256 });
    case "dismiss":
      return call("machines.dismiss", { hostKey });
    case "take-over":
      // Asks first, in place (`TaskConflictCard`); only its confirm sends the request.
      return null;
  }
};

/** The evidence: a command or ssh's own line (S4: sunken, `row` radius, 10/12 padding). */
const Well = ({ children }: { readonly children: string }) => (
  <pre className="border-hairline bg-surface-sunken text-code-inline text-text-subtle py-row-x rounded-row border px-3 font-mono leading-[18px] whitespace-pre-wrap">
    {children}
  </pre>
);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** ⌘↵ approves while the approval shows (Paper 5FB-1's keycap). */
const useApproveShortcut = (approve: () => void) =>
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !modKey(event) || isTyping(event.target)) return;
      event.preventDefault();
      approve();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [approve]);

export const Approval = ({ machine }: { readonly machine: MachineView }) => {
  const facts = offerFacts(machine);
  const approve = () => void runAction(machine, "approve", { openSsh: () => undefined });

  useApproveShortcut(approve);

  if (facts === null) return null;

  return (
    <div className="gap-row-x flex flex-col" data-testid="install-approval">
      <p className="text-body text-text-default">
        No Polaris daemon runs on {machine.label} yet. Approve this build once; upgrades install on
        their own.
      </p>
      <InstallWell facts={facts} />
      <div className="gap-gap flex items-center">
        <Button onClick={approve}>
          Approve and install
          <Kbd>{shortcutLabel(FIELD_CHORDS.submit)}</Kbd>
        </Button>
        <Button
          variant="ghost"
          onClick={() => void runAction(machine, "dismiss", { openSsh: () => undefined })}
        >
          Not now
        </Button>
        <span className="text-caption text-text-subtle">
          Copied from {clientCopy().machine}, nothing downloaded.
        </span>
      </div>
    </div>
  );
};

const ActionButton = ({
  button,
  ghost,
  detail,
  onAction,
}: {
  readonly button: CardButton;
  readonly ghost: boolean;
  readonly detail: string | null;
  readonly onAction: () => void;
}) =>
  button.action === "copy-detail" && detail !== null ? (
    <CopyButton
      variant="button"
      buttonVariant={ghost ? "ghost" : "secondary"}
      label={button.label}
      text={detail}
    />
  ) : (
    <Button variant={ghost ? "ghost" : "secondary"} onClick={onAction}>
      {button.label}
    </Button>
  );

/** The card's sentence, evidence and buttons, as every reason shows them. */
const ReasonCard = ({
  model,
  onAction,
}: {
  readonly model: CardModel;
  readonly onAction: (button: CardButton) => void;
}) => {
  // The client reports steps, not bytes: work in progress is the dither, never a guessed bar.
  const busy = model.reason === "checking" || model.reason === "installing";
  const { fix, secondary } = model;

  return (
    <>
      <p className="text-body text-text-default flex items-center gap-2">
        {busy ? <Dither hue="starlight" size={12} /> : null}
        <span>
          {model.title}. {model.body}
        </span>
      </p>
      {model.detail === null ? null : <Well>{model.detail}</Well>}
      {fix === null && secondary === null ? null : (
        <div className="gap-gap flex items-center">
          {fix === null ? null : (
            <ActionButton
              button={fix}
              ghost={false}
              detail={model.detail}
              onAction={() => onAction(fix)}
            />
          )}
          {secondary === null ? null : (
            <ActionButton
              button={secondary}
              ghost={fix !== null}
              detail={model.detail}
              onAction={() => onAction(secondary)}
            />
          )}
        </div>
      )}
    </>
  );
};

/**
 * A sign-in task another Polaris home holds: which home, then "Take over sign-in task",
 * which asks in place with the consequence before anything runs (DESIGN.md, Hosts (S4)).
 */
export const TaskConflictCard = ({
  machine,
  model,
}: {
  readonly machine: MachineView;
  readonly model: CardModel;
}) => {
  const [asking, setAsking] = useState(false);
  const confirmation = asking ? takeOverConfirmation(machine) : null;
  const hostKey = machine.key;

  const onAction = (button: CardButton) =>
    button.action === "take-over"
      ? setAsking(true)
      : void runAction(machine, button.action, { openSsh: () => undefined });

  if (confirmation === null) return <ReasonCard model={model} onAction={onAction} />;

  return (
    <div className="gap-row-x flex flex-col" data-testid="take-over-confirmation">
      <p className="text-body text-text-default">
        {confirmation.title}. {confirmation.body}
      </p>
      <div className="gap-gap flex items-center">
        <Button variant="ghost" autoFocus onClick={() => setAsking(false)}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setAsking(false);
            void call("machines.takeOverTask", { hostKey });
          }}
        >
          {confirmation.confirm}
        </Button>
      </div>
    </div>
  );
};

/**
 * The row's reason, flat; and `ssh <alias>` in a terminal on this Mac's local
 * Host under it (to trust a host key), macOS Terminal only while that is off.
 */
export const Attention = ({ machine }: { readonly machine: MachineView }) => {
  const localUp = useApp(
    (s) => s.hosts.find((h) => h.key === "local")?.status.state === "connected"
  );

  const [ssh, setSsh] = useState(false);
  const model = attentionCard(machine);

  if (model === null) return null;

  const context: ActionContext = {
    openSsh: () =>
      localUp ? setSsh(true) : void call("machines.openSsh", { hostKey: machine.key }),
  };

  const run = (button: CardButton) => void runAction(machine, button.action, context);

  return (
    <div
      className="gap-row-x flex flex-col"
      data-testid="attention-card"
      data-reason={model.reason}
    >
      {model.reason === "task-conflict" ? (
        <TaskConflictCard machine={machine} model={model} />
      ) : (
        <ReasonCard model={model} onAction={run} />
      )}
      {ssh && machine.alias !== null ? (
        <slots.HarnessTerminal
          hostKey="local"
          argv={["ssh", "--", machine.alias]}
          onExit={() => void call("host.retryNow", { hostKey: machine.key })}
          onClose={() => setSsh(false)}
        />
      ) : null}
    </div>
  );
};
