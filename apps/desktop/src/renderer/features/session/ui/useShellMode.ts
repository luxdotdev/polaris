/**
 * Shell mode in the session composer: a draft starting with `!` is a shell command, where
 * the Host has `session.shell-command` and the session's Harness `runsShellCommands`.
 * Between Turns it runs as a Turn of its own; while one works it waits as a follow-up.
 */
import type { HarnessKind, SessionId } from "@polaris/protocol";
import { isShellDraft, leaveShell, shellCommandOf } from "../../composer/index.ts";
import { useHarnessModels } from "../../harness/index.ts";
import { send } from "../dispatch.ts";
import { hasCapability, useHost } from "../hooks.ts";
import { type ComposerMode, queuedCommand } from "../model/intent.ts";
import type { OutboxActions } from "../outbox.ts";
import { patchSessionUi } from "../state.ts";

export interface ShellMode {
  /** The draft is a shell command. */
  readonly active: boolean;
  /** There is a command to run (not `!` alone). */
  readonly ready: boolean;
  /** For the composer's cue: where it runs, and whether it waits for the Turn in flight. */
  readonly cue: { readonly where: string; readonly queued: boolean } | undefined;
  /** esc: leaves shell mode, keeping the rest of the draft. */
  readonly escape: (() => void) | undefined;
  /** ↵: runs it now, or queues it for after the Turn in flight. Staged attachments stay. */
  readonly submit: () => void;
}

const TAKES_SHELL: ReadonlySet<ComposerMode["kind"]> = new Set(["send", "steer", "queue"]);

export interface ShellModeInput {
  readonly hostKey: string;
  readonly uiKey: string;
  readonly sessionId: SessionId;
  readonly harness: HarnessKind;
  readonly mode: ComposerMode;
  readonly draft: string;
  /** Where it runs, as shown (`~/code/polaris`). */
  readonly where: string;
  readonly outbox: OutboxActions;
  /** The composer submits somewhere else (a Constellation's own composer): no shell mode. */
  readonly elsewhere: boolean;
}

export const useShellMode = (input: ShellModeInput): ShellMode => {
  const { hostKey, uiKey, draft, mode } = input;
  const host = useHost(hostKey);
  const { runsShellCommands } = useHarnessModels(hostKey, input.harness);

  const canRunShell =
    !input.elsewhere &&
    TAKES_SHELL.has(mode.kind) &&
    hasCapability(host, "session.shell-command") &&
    runsShellCommands;

  const active = isShellDraft(draft, canRunShell);
  const queued = active && mode.kind !== "send";
  const ready = active && shellCommandOf(draft) !== null;

  const submit = () => {
    if (!ready) return;
    patchSessionUi(uiKey, () => ({ draft: "" }));

    if (queued) return input.outbox.queue(draft, [], true);
    const command = queuedCommand(input.sessionId, { text: draft, attachments: [], shell: true });

    if (command === null) return;
    void send(hostKey, command, "Couldn't run").then((ok) => {
      if (!ok) patchSessionUi(uiKey, () => ({ draft }));
    });
  };

  return {
    active,
    ready,
    cue: active ? { where: input.where, queued } : undefined,
    escape: active
      ? () => patchSessionUi(uiKey, (ui) => ({ draft: leaveShell(ui.draft) }))
      : undefined,
    submit,
  };
};
