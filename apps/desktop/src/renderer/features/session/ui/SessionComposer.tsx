/**
 * The open session's composer: sends a Turn, steers the one in flight, stops
 * it (esc), attaches files, and switches Model between Turns (or forks when
 * the Harness can't switch).
 */
import type { SessionId } from "@polaris/protocol";
import type { Harness } from "@polaris/ui";
import { Commands, newSessionId } from "../../../commands.ts";
import type { SessionData } from "../../../store/plain.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { useStaging } from "../attachments.ts";
import { send } from "../dispatch.ts";
import { hasCapability, useElapsed, useHarnessModels, useHost } from "../hooks.ts";
import { formatElapsed } from "../model/format.ts";
import {
  composerMode,
  forkCommand,
  interruptCommand,
  placeholderFor,
  submitCommand,
} from "../model/intent.ts";
import type { ModelChoice } from "../model/models.ts";
import { patchSessionUi, useSessionUi } from "../state.ts";
import { DraftComposer } from "./DraftComposer.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

export interface SessionComposerProps {
  readonly hostKey: string;
  readonly uiKey: string;
  readonly harness: Harness;
  readonly session: SessionData;
  readonly model: SessionModel;
  readonly branch: string | undefined;
  readonly onOpenSession?: ((sessionId: SessionId) => void) | undefined;
}

const useModelChange = ({ hostKey, session, model, onOpenSession }: SessionComposerProps) => {
  const host = useHost(hostKey);
  const { switchesModel } = useHarnessModels(hostKey, session.harness);
  const canSet = switchesModel && hasCapability(host, "session.set-model");
  const lastDone = model.turns.findLast((t) => t.turn.status !== "working")?.turn;

  const change = (choice: ModelChoice) => {
    if (canSet) {
      void send(
        hostKey,
        Commands.SetModel({ sessionId: session.id, ...choice }),
        "Couldn't switch"
      );

      return;
    }

    if (lastDone === undefined) return;
    const sessionId = newSessionId();

    const fork = forkCommand({
      sessionId,
      fromSessionId: session.id,
      fromTurnId: lastDone.id,
      harness: session.harness,
      ...choice,
    });

    void send(hostKey, fork, "Couldn't fork").then((ok) => {
      if (ok) onOpenSession?.(sessionId);
    });
  };

  const note = canSet
    ? "Applies from the next turn"
    : "This harness can't switch model mid-session; picking one forks a new session";

  return { change, note };
};

export const SessionComposer = (props: SessionComposerProps) => {
  const { hostKey, uiKey, harness, session, model, branch } = props;
  const host = useHost(hostKey);
  const ui = useSessionUi(uiKey);
  const lastTurn = model.turns.at(-1)?.turn ?? null;
  const isWorking = lastTurn?.status === "working";
  const elapsed = useElapsed(lastTurn?.startedAt ?? null, isWorking);

  const mode = composerMode({
    state: session.state,
    lastTurn: lastTurn?.status ?? null,
    pendingApprovals: model.pendingApprovals.length,
    canSteer: hasCapability(host, "session.steer"),
  });

  const draft = { text: ui.draft, attachments: ui.attachments.map((a) => a.id) };
  const command = submitCommand(mode, session.id, draft);

  const { stage, pending } = useStaging(
    { hostKey, workspaceId: session.workspaceId, sessionId: session.id },
    (staged) => patchSessionUi(uiKey, (u) => ({ attachments: [...u.attachments, staged] }))
  );

  const modelChange = useModelChange(props);

  const submit = () => {
    if (command === null) return;
    const kept = ui;

    patchSessionUi(uiKey, () => ({ draft: "", attachments: [] }));
    void send(hostKey, command, mode.kind === "steer" ? "Couldn't steer" : "Couldn't send").then(
      (ok) => {
        if (!ok)
          patchSessionUi(uiKey, () => ({ draft: kept.draft, attachments: kept.attachments }));
      }
    );
  };

  const stop = () => {
    const interrupt = interruptCommand(session.id, lastTurn?.status ?? null);

    if (interrupt !== null) void send(hostKey, interrupt, "Couldn't stop");
  };

  return (
    <DraftComposer
      className="px-4 pb-4"
      harness={harness}
      picker={
        <ModelPicker
          hostKey={hostKey}
          harness={harness}
          model={session.model}
          effort={session.effort}
          working={isWorking}
          disabled={isWorking}
          note={modelChange.note}
          onChoose={modelChange.change}
        />
      }
      value={ui.draft}
      onChange={(text) => patchSessionUi(uiKey, () => ({ draft: text }))}
      onSubmit={submit}
      canSubmit={command !== null}
      placeholder={placeholderFor(mode)}
      working={isWorking ? { elapsed: formatElapsed(elapsed), onStop: stop } : undefined}
      onEscape={isWorking ? stop : undefined}
      attachments={ui.attachments}
      staging={pending}
      onFiles={hasCapability(host, "attachments.stage") ? stage : undefined}
      onRemoveAttachment={(a) =>
        patchSessionUi(uiKey, (u) => ({ attachments: u.attachments.filter((x) => x !== a) }))
      }
      branch={branch}
    />
  );
};
