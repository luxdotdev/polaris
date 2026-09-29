/**
 * The new-session page (DESIGN.md, New session; Paper artboard 4): the scene,
 * where it runs, the composer and the Harness choice. Sends `StartSession`,
 * or `ForkSession` then the prompt as its first Turn for "Fork a turn".
 */
import type { Command, PermissionMode, SessionId, Workspace, WorkspaceId } from "@polaris/protocol";
import { Clearing, type Harness, Scene } from "@polaris/ui";
import { useState } from "react";
import { newSessionId } from "../../../commands.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { useApp } from "../../../views/hooks.ts";
import { useStaging } from "../attachments.ts";
import { send } from "../dispatch.ts";
import { hasCapability, useHarnessModels, useHost } from "../hooks.ts";
import { tildePath } from "../model/format.ts";
import { defaultChoice, type ModelChoice, modelLabel } from "../model/models.ts";
import {
  branchFromPrompt,
  forkStartCommands,
  type HarnessChoice,
  type PlacementChoice,
  startCommand,
} from "../model/newSession.ts";
import { patchSessionUi, type SessionUi, uiKey, useSessionUi } from "../state.ts";
import { DraftComposer } from "./DraftComposer.tsx";
import { ForkSource, type ForkSourceValue } from "./ForkSource.tsx";
import { HarnessChoiceRow } from "./HarnessChoice.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { PermissionChip, WhereLine } from "./placement.tsx";

export interface NewSessionPageProps {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  /** The session exists (its feed may still be catching up): open it. */
  readonly onStarted: (sessionId: SessionId) => void;
}

type Models = Readonly<Record<Harness, ModelChoice | null>>;

const useCaptions = (hostKey: string, picked: Models): Record<Harness, string> => {
  const claude = useHarnessModels(hostKey, "claude");
  const codex = useHarnessModels(hostKey, "codex");

  const caption = (models: typeof claude, harness: Harness) => {
    const choice = picked[harness] ?? defaultChoice(harness, models.models);

    return modelLabel(models.models, choice?.model ?? null, choice?.effort ?? null);
  };

  return { claude: caption(claude, "claude"), codex: caption(codex, "codex") };
};

interface Choices {
  readonly choice: HarnessChoice;
  readonly models: Models;
  readonly permissionMode: PermissionMode;
  readonly placement: PlacementChoice;
  readonly fork: ForkSourceValue | null;
}

const harnessOf = (choices: Choices): Harness => {
  if (choices.choice !== "fork") return choices.choice;

  return choices.fork?.session.harness === "codex" ? "codex" : "claude";
};

/** A new worktree with no branch named yet takes one from the prompt. */
const resolvePlacement = (placement: PlacementChoice, prompt: string): PlacementChoice =>
  placement.kind === "new-worktree" && placement.branch === ""
    ? { ...placement, branch: branchFromPrompt(prompt, "session") }
    : placement;

/** The commands a submit sends, in order; null while the page can't start anything. */
const commandsFor = (
  sessionId: SessionId,
  workspaceId: WorkspaceId,
  choices: Choices,
  ui: SessionUi
): ReadonlyArray<Command> | null => {
  const harness = harnessOf(choices);
  const attachments = ui.attachments.map((a) => a.id);
  const model = choices.models[harness];

  if (choices.choice === "fork") {
    if (choices.fork === null) return null;
    const { session, turnId } = choices.fork;

    return forkStartCommands({
      sessionId,
      fromSessionId: session.id,
      fromTurnId: turnId,
      harness,
      model,
      prompt: ui.draft,
      attachments,
    });
  }

  const start = startCommand({
    sessionId,
    workspaceId,
    harness,
    placement: resolvePlacement(choices.placement, ui.draft),
    permissionMode: choices.permissionMode,
    model,
    prompt: ui.draft,
    attachments,
  });

  return start === null ? null : [start];
};

/** Sends each command in turn, stopping at the first refusal; true if the first landed. */
const sendAll = async (hostKey: string, commands: ReadonlyArray<Command>) => {
  let first = true;

  for (const command of commands) {
    const ok = await send(hostKey, command, first ? "Couldn't start the session" : "Couldn't send");

    if (!ok) return !first;
    first = false;
  }

  return true;
};

const defaultPlacement = (workspace: Workspace): PlacementChoice =>
  workspace.isGitRepo ? { kind: "new-worktree", branch: "", base: null } : { kind: "in-place" };

const PREVIEW_ID = newSessionId();

export const NewSessionPage = ({ hostKey, workspaceId, onStarted }: NewSessionPageProps) => {
  const host = useHost(hostKey);
  const hostModel = useApp((s) => s.hostModels[hostKey]) ?? emptyHostModel;
  const workspace = hostModel.workspaces.get(workspaceId);
  const key = uiKey(hostKey, `new:${workspaceId}`);
  const ui = useSessionUi(key);
  const [choice, setChoice] = useState<HarnessChoice>("claude");
  const [models, setModels] = useState<Models>({ claude: null, codex: null });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("supervised");
  const [placement, setPlacement] = useState<PlacementChoice | null>(null);
  const [forkSession, setForkSession] = useState<SessionId | null>(null);
  const [fork, setFork] = useState<ForkSourceValue | null>(null);
  const [busy, setBusy] = useState(false);
  const captions = useCaptions(hostKey, models);

  const { stage, pending } = useStaging({ hostKey, workspaceId, sessionId: null }, (staged) =>
    patchSessionUi(key, (u) => ({ attachments: [...u.attachments, staged] }))
  );

  if (workspace === undefined) return <Scene className="h-full flex-1" data-testid="new-session" />;
  const where = placement ?? defaultPlacement(workspace);
  const choices: Choices = { choice, models, permissionMode, placement: where, fork };
  const harness = harnessOf(choices);
  const canSubmit = !busy && commandsFor(PREVIEW_ID, workspaceId, choices, ui) !== null;
  const shown = resolvePlacement(where, ui.draft);

  const submit = () => {
    const sessionId = newSessionId();
    const commands = commandsFor(sessionId, workspaceId, choices, ui);

    if (busy || commands === null) return;
    setBusy(true);
    void sendAll(hostKey, commands).then((started) => {
      setBusy(false);

      if (!started) return;
      patchSessionUi(key, () => ({ draft: "", attachments: [] }));
      onStarted(sessionId);
    });
  };

  return (
    <Scene
      className="flex h-full min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-[92px]"
      data-testid="new-session"
    >
      <Clearing className="flex flex-col items-center gap-2 px-20 pt-7 pb-8 text-center">
        <p className="text-caption text-starlight font-medium tracking-[0.02em]">
          New session · {workspace.name}
        </p>
        <h1 className="text-display text-text-strong tracking-[-0.015em]">
          What should happen next?
        </h1>
        <WhereLine
          hostLabel={host?.label ?? hostKey}
          path={tildePath(workspace.path, host?.status.host?.homeDir ?? null)}
          placement={where}
          worktrees={[...hostModel.worktrees.values()].filter(
            (w) => w.workspaceId === workspaceId && !w.isMain
          )}
          canWorktree={workspace.isGitRepo}
          onChange={setPlacement}
        />
      </Clearing>
      <div className="flex w-full max-w-[640px] flex-col gap-3.5 pt-1 pb-10">
        <DraftComposer
          className="shadow-float rounded-card"
          harness={harness}
          autoFocus
          picker={
            <ModelPicker
              hostKey={hostKey}
              harness={harness}
              model={models[harness]?.model ?? null}
              effort={models[harness]?.effort ?? null}
              onChoose={(next) => setModels({ ...models, [harness]: next })}
            />
          }
          tools={<PermissionChip value={permissionMode} onChange={setPermissionMode} />}
          value={ui.draft}
          onChange={(text) => patchSessionUi(key, () => ({ draft: text }))}
          onSubmit={submit}
          canSubmit={canSubmit}
          placeholder="Describe the change"
          attachments={ui.attachments}
          staging={pending}
          onFiles={hasCapability(host, "attachments.stage") ? stage : undefined}
          onRemoveAttachment={(a) =>
            patchSessionUi(key, (u) => ({ attachments: u.attachments.filter((x) => x !== a) }))
          }
          branch={shown.kind === "new-worktree" && choice !== "fork" ? shown.branch : undefined}
          prominentSend
        />
        <HarnessChoiceRow
          value={choice}
          onChange={setChoice}
          captions={captions}
          canFork={hasCapability(host, "session.fork")}
        />
        {choice === "fork" ? (
          <ForkSource
            hostKey={hostKey}
            workspaceId={workspaceId}
            sessionId={forkSession}
            onSession={setForkSession}
            onChange={setFork}
          />
        ) : null}
      </div>
    </Scene>
  );
};
