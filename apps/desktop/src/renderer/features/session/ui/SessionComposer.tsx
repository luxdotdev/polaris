/**
 * The open session's composer: sends a Turn, steers the one in flight, stops
 * it (esc), attaches files, and switches Model between Turns (or forks when
 * the Harness can't switch).
 */
import type { SessionId } from "@polaris/protocol";
import { Button, type Harness } from "@polaris/ui";
import { useEffect } from "react";
import { Commands, newSessionId } from "../../../commands.ts";
import type { SessionData } from "../../../store/plain.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { useUploads } from "../../attachments/index.ts";
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
import { formatElapsed, tildePath } from "../model/format.ts";
import {
  canQueue,
  type ComposerMode,
  composerMode,
  forkCommand,
  interruptCommand,
  openQuestion,
  placeholderFor,
  queuedCommand,
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

const SEND_FAILURES: Readonly<Record<ComposerMode["kind"], string>> = {
  send: "Couldn't send",
  steer: "Couldn't steer",
  queue: "Couldn't queue",
  answer: "Couldn't answer",
  blocked: "Couldn't send",
};

/** Sends the queued follow-up as the next Turn once the session takes one again. */
const useSendQueued = ({
  hostKey,
  uiKey,
  sessionId,
  ready,
}: {
  readonly hostKey: string;
  readonly uiKey: string;
  readonly sessionId: SessionId;
  readonly ready: boolean;
}) => {
  const queued = useSessionUi(uiKey).queued;

  useEffect(() => {
    if (!ready || queued === null) return;

    const command = queuedCommand(sessionId, {
      text: queued.text,
      attachments: queued.attachments.map((a) => a.id),
    });

    patchSessionUi(uiKey, () => ({ queued: null }));

    if (command !== null)
      void send(hostKey, command, "Couldn't send the queued follow-up").then((ok) => {
        if (!ok) patchSessionUi(uiKey, () => ({ queued }));
      });
  }, [ready, queued, hostKey, uiKey, sessionId]);
};

/** The follow-up waiting for the Turn in flight, above the composer. */
const Queued = ({ text, onCancel }: { readonly text: string; readonly onCancel: () => void }) => (
  <div
    className="rounded-row border-hairline bg-surface-raised mb-1.5 flex h-8 items-center gap-2 border pr-1 pl-3"
    data-testid="queued-follow-up"
  >
    <span className="text-caption text-text-subtle shrink-0">Queued for after this turn</span>
    <span className="text-caption text-text-default min-w-0 flex-1 truncate">{text}</span>
    <Button variant="ghost" size="sm" onClick={onCancel}>
      Cancel
    </Button>
  </div>
);

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
    question: openQuestion(model.pendingApprovals),
    canSteer: hasCapability(host, "session.steer"),
  });

  const draft = { text: ui.draft, attachments: ui.attachments.map((a) => a.id) };
  const command = submitCommand(mode, session.id, draft);

  const shownCwd = tildePath(session.cwd, host?.status.host?.homeDir ?? null);

  const { upload, uploads } = useUploads(
    {
      hostKey,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      copyTo: { path: session.cwd, shown: shownCwd },
    },
    (staged) => patchSessionUi(uiKey, (u) => ({ attachments: [...u.attachments, staged] }))
  );

  const change = useModelChange(props);

  const queue = () => {
    if (!canQueue(mode) || (ui.draft.trim() === "" && ui.attachments.length === 0)) return;

    patchSessionUi(uiKey, (u) => ({
      queued: { text: u.draft, attachments: u.attachments },
      draft: "",
      attachments: [],
    }));
  };

  useSendQueued({ hostKey, uiKey, sessionId: session.id, ready: mode.kind === "send" });

  const submit = () => {
    if (mode.kind === "queue") return queue();

    if (command === null) return;
    const kept = ui;

    patchSessionUi(uiKey, () => ({ draft: "", attachments: [] }));
    void send(hostKey, command, SEND_FAILURES[mode.kind]).then((ok) => {
      if (!ok) patchSessionUi(uiKey, () => ({ draft: kept.draft, attachments: kept.attachments }));
    });
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
      onQueue={canQueue(mode) ? queue : undefined}
      notice={
        ui.queued === null ? null : (
          <Queued
            text={ui.queued.text}
            onCancel={() =>
              patchSessionUi(uiKey, (u) => ({
                queued: null,
                draft: u.draft === "" ? (u.queued?.text ?? "") : u.draft,
              }))
            }
          />
        )
      }
      canSubmit={command !== null || (mode.kind === "queue" && ui.draft.trim() !== "")}
      placeholder={placeholderFor(mode)}
      working={
        isWorking && session.state === "working"
          ? { elapsed: formatElapsed(elapsed), onStop: stop }
          : undefined
      }
      onEscape={isWorking ? stop : undefined}
      attachments={ui.attachments}
      uploads={uploads}
      copyTo={shownCwd}
      onFiles={hasCapability(host, "attachments.stage") ? upload : undefined}
      onRemoveAttachment={(a) =>
        patchSessionUi(uiKey, (u) => ({ attachments: u.attachments.filter((x) => x !== a) }))
      }
      branch={branch}
    />
  );
};
