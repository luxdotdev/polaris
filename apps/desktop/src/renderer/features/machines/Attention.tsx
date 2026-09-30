/**
 * What a Host's row says when it needs the user, flat inside the row as in
 * Paper S4 (7CV-1): what happened in one sentence, the evidence in a sunken
 * well, and its actions, all secondary: "Add a host" is the page's one
 * primary button (DESIGN.md, Settings · Hosts; Buttons). Never a modal.
 */
import { Button, Dither, InstallWell, Kbd } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { slots } from "../../app/slots.tsx";
import { useApp } from "../../shell/hooks.ts";
import { call } from "./hooks.tsx";
import { type CardAction, type CardButton, attentionCard, offerFacts } from "./model.ts";

/** What an action needs beyond requests: where "Open in terminal" runs. */
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
      if (event.key !== "Enter" || !event.metaKey || isTyping(event.target)) return;
      event.preventDefault();
      approve();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [approve]);

export const Approval = ({ machine }: { readonly machine: MachineView }) => {
  const facts = offerFacts(machine);
  const approve = () => void runAction(machine, "approve", null, { openSsh: () => undefined });

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
          <Kbd>⌘↵</Kbd>
        </Button>
        <Button
          variant="ghost"
          onClick={() => void runAction(machine, "dismiss", null, { openSsh: () => undefined })}
        >
          Not now
        </Button>
        <span className="text-caption text-text-subtle">
          Copied from this Mac, nothing downloaded.
        </span>
      </div>
    </div>
  );
};

const ActionButton = ({
  button,
  ghost,
  onAction,
}: {
  readonly button: CardButton;
  readonly ghost: boolean;
  readonly onAction: () => void;
}) => (
  <Button variant={ghost ? "ghost" : "secondary"} onClick={onAction}>
    {button.label}
  </Button>
);

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

  const run = (button: CardButton) => () =>
    void runAction(machine, button.action, model.detail, context);
  // The client reports steps, not bytes: work in progress is the dither, never a guessed bar.

  const busy = model.reason === "checking" || model.reason === "installing";

  return (
    <div
      className="gap-row-x flex flex-col"
      data-testid="attention-card"
      data-reason={model.reason}
    >
      <p className="text-body text-text-default flex items-center gap-2">
        {busy ? <Dither hue="starlight" size={12} /> : null}
        <span>
          {model.title}. {model.body}
        </span>
      </p>
      {model.detail === null ? null : <Well>{model.detail}</Well>}
      {model.fix === null && model.secondary === null ? null : (
        <div className="gap-gap flex items-center">
          {model.fix === null ? null : (
            <ActionButton button={model.fix} ghost={false} onAction={run(model.fix)} />
          )}
          {model.secondary === null ? null : (
            <ActionButton
              button={model.secondary}
              ghost={model.fix !== null}
              onAction={run(model.secondary)}
            />
          )}
        </div>
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
