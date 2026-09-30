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
import {
  HarnessChip,
  type HarnessOption,
  type ModelChange,
  modelChange,
  type ModelChoice,
  useHarnessModels,
  useSignIn,
} from "../../harness/index.ts";
import { hasCapability, useElapsed, useHost } from "../hooks.ts";
import { formatElapsed } from "../model/format.ts";
import {
  composerMode,
  forkCommand,
  interruptCommand,
  placeholderFor,
  submitCommand,
} from "../model/intent.ts";
import { patchSessionUi, useSessionUi } from "../state.ts";
import { DraftComposer } from "./DraftComposer.tsx";

export interface SessionComposerProps {
  readonly hostKey: string;
  readonly uiKey: string;
  readonly harness: Harness;
  readonly session: SessionData;
  readonly model: SessionModel;
  readonly branch: string | undefined;
  readonly onOpenSession?: ((sessionId: SessionId) => void) | undefined;
}

const CHANGE_NOTES: Readonly<Record<ModelChange["kind"], string | undefined>> = {
  fork: "This harness can't switch model in a session; picking one forks a new session",
  set: "Applies from the next turn",
  blocked: undefined,
};

/** Picking a Model: `SetModel` between Turns, else a Fork on it; another Harness forks too. */
const useModelChange = ({ hostKey, session, model, onOpenSession }: SessionComposerProps) => {
  const host = useHost(hostKey);
  const { switchesModel } = useHarnessModels(hostKey, session.harness);
  const lastDone = model.turns.findLast((t) => t.turn.status !== "working")?.turn;
  const signIn = useSignIn(hostKey);

  const change = modelChange({
    switchesModel,
    canSetModel: hasCapability(host, "session.set-model"),
    canFork: hasCapability(host, "session.fork"),
    turnInFlight: model.turns.at(-1)?.turn.status === "working",
    hasFinishedTurn: lastDone !== undefined,
  });

  const fork = (harness: string, choice: ModelChoice | null) => {
    if (lastDone === undefined) return;
    const sessionId = newSessionId();

    const command = forkCommand({
      sessionId,
      fromSessionId: session.id,
      fromTurnId: lastDone.id,
      harness,
      model: choice?.model ?? null,
      effort: choice?.effort ?? null,
    });

    void send(hostKey, command, "Couldn't fork").then((ok) => {
      if (ok) onOpenSession?.(sessionId);
    });
  };

  const onModel = (choice: ModelChoice) => {
    if (change.kind === "set")
      void send(
        hostKey,
        Commands.SetModel({ sessionId: session.id, ...choice }),
        "Couldn't switch"
      );
    else if (change.kind === "fork") fork(session.harness, choice);
  };

  const onPick = (option: HarnessOption) =>
    option.status === "needs-sign-in" ? signIn.begin(option) : fork(option.kind, null);

  const note = CHANGE_NOTES[change.kind];

  return {
    onModel,
    note,
    blocked: change.kind === "blocked" ? change.reason : undefined,
    harnesses:
      lastDone !== undefined && hasCapability(host, "session.fork")
        ? {
            onPick,
            verb: (o: HarnessOption) =>
              o.status === "needs-sign-in" ? `Sign in to ${o.name}` : `Fork on ${o.name}`,
          }
        : undefined,
    dialog: signIn.dialog,
  };
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

  const change = useModelChange(props);

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
      className="px-panel pb-panel"
      harness={harness}
      picker={
        <>
          <HarnessChip
            hostKey={hostKey}
            harness={harness}
            model={session.model}
            effort={session.effort}
            working={isWorking && session.state === "working"}
            modelNote={change.note}
            modelBlocked={change.blocked}
            onModel={change.onModel}
            {...(change.harnesses === undefined ? {} : { harnesses: change.harnesses })}
          />
          {change.dialog}
        </>
      }
      value={ui.draft}
      onChange={(text) => patchSessionUi(uiKey, () => ({ draft: text }))}
      onSubmit={submit}
      canSubmit={command !== null}
      placeholder={placeholderFor(mode)}
      working={
        isWorking && session.state === "working"
          ? { elapsed: formatElapsed(elapsed), onStop: stop }
          : undefined
      }
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
