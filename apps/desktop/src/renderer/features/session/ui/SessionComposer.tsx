/**
 * The open session's composer: sends a Turn, steers the one in flight, stops
 * it (esc), attaches files, and switches Model between Turns (or forks when
 * the Harness can't switch).
 */
import { fastToggle } from "../../harness/model/fast.ts";
import type { SessionId } from "@polaris/protocol";
import { useState } from "react";
import { type Harness, harnessHue } from "@polaris/ui";
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
  submitCommand,
} from "../model/intent.ts";
import { patchSessionUi, useSessionUi } from "../state.ts";
import type { OutboxActions } from "../outbox.ts";
import { promptFor } from "../../composer/index.ts";
import { RotatingVerb, useWorkingVerbs } from "../verbs/index.ts";
import { type ComposerCommands, DraftComposer } from "./DraftComposer.tsx";
import { useComposerCommands } from "./useComposerCommands.ts";
import { useSessionChrome } from "../chrome.ts";

export interface SessionComposerProps {
  readonly hostKey: string;
  readonly uiKey: string;
  readonly harness: Harness;
  readonly session: SessionData;
  readonly model: SessionModel;
  readonly branch: string | undefined;
  readonly onOpenSession?: ((sessionId: SessionId) => void) | undefined;
  /** Steers and follow-ups go through the session's outbox, which shows them until they land. */
  readonly outbox: OutboxActions;
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
      serviceTier: choice?.serviceTier ?? null,
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

export const SessionComposer = (props: SessionComposerProps) => {
  const { hostKey, uiKey, harness, session, model, branch } = props;
  const host = useHost(hostKey);
  const ui = useSessionUi(uiKey);
  const lastTurn = model.turns.at(-1)?.turn ?? null;
  const isWorking = lastTurn?.status === "working";
  const elapsed = useElapsed(lastTurn?.startedAt ?? null, isWorking);

  const verbs = useWorkingVerbs({
    hostKey,
    harness,
    cwd: session.cwd,
    turnId: isWorking ? (lastTurn?.id ?? null) : null,
  });

  const mode = composerMode({
    state: session.state,
    lastTurn: lastTurn?.status ?? null,
    pendingApprovals: model.pendingApprovals.length,
    question: openQuestion(model.pendingApprovals),
    canSteer: hasCapability(host, "session.steer"),
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const chrome = useSessionChrome();

  const change = useModelChange(props);
  const fastAvailable = session.harness === "codex" && hasCapability(host, "session.service-tier");

  const commands: ComposerCommands = useComposerCommands({
    hostKey,
    workspaceId: session.workspaceId,
    harness: session.harness,
    cwd: session.cwd,
    openModels: () => setPickerOpen(true),
    toggleFast: fastToggle(fastAvailable, change.blocked, session, change.onModel),
  });
  // What the Turn sends: a Codex custom prompt goes expanded (`promptFor`).

  const text = promptFor(ui.draft, commands.options);
  const draft = { text, attachments: ui.attachments.map((a) => a.id) };
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

  const queue = () => {
    if (!canQueue(mode) || (ui.draft.trim() === "" && ui.attachments.length === 0)) return;

    props.outbox.queue(text, ui.attachments);
    patchSessionUi(uiKey, () => ({ draft: "", attachments: [] }));
  };

  const submit = () => {
    if (chrome.composer !== undefined) return submitElsewhere(chrome.composer.onSubmit);

    if (mode.kind === "queue") return queue();

    if (command === null) return;

    if (mode.kind === "steer") {
      props.outbox.steer(text);
      patchSessionUi(uiKey, () => ({ draft: "" }));

      return;
    }

    const kept = ui;

    patchSessionUi(uiKey, () => ({ draft: "", attachments: [] }));
    void send(hostKey, command, SEND_FAILURES[mode.kind]).then((ok) => {
      if (!ok) patchSessionUi(uiKey, () => ({ draft: kept.draft, attachments: kept.attachments }));
    });
  };

  const submitElsewhere = (onSubmit: (text: string) => Promise<boolean>) => {
    const kept = ui.draft;

    if (kept.trim() === "") return;
    patchSessionUi(uiKey, () => ({ draft: "" }));
    void onSubmit(kept).then((ok) => {
      if (!ok) patchSessionUi(uiKey, () => ({ draft: kept }));
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
            serviceTier={session.serviceTier}
            fastAvailable={fastAvailable}
            working={isWorking && session.state === "working"}
            modelNote={change.note}
            modelBlocked={change.blocked}
            onModel={change.onModel}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            {...(change.harnesses === undefined ? {} : { harnesses: change.harnesses })}
          />
          {change.dialog}
        </>
      }
      value={ui.draft}
      onChange={(text) => patchSessionUi(uiKey, () => ({ draft: text }))}
      onSubmit={submit}
      onQueue={canQueue(mode) ? queue : undefined}
      canSubmit={
        chrome.composer === undefined
          ? command !== null || (mode.kind === "queue" && ui.draft.trim() !== "")
          : ui.draft.trim() !== ""
      }
      placeholder={chrome.composer?.placeholder ?? placeholderFor(mode)}
      working={
        isWorking && session.state === "working"
          ? {
              elapsed: formatElapsed(elapsed),
              onStop: stop,
              label: (
                <RotatingVerb verbs={verbs} spoken={`${harnessHue(harness).name} is working`} />
              ),
            }
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
      commands={commands}
    />
  );
};
