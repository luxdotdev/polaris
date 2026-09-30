/**
 * The new-session page (DESIGN.md, New session; Paper artboard 4): the scene,
 * where it runs, the composer and the Harness choice. Sends `StartSession`,
 * or `ForkSession` then the prompt as its first Turn for "Fork a turn".
 */
import {
  type Command,
  isKnownHarness,
  type PermissionMode,
  type SessionId,
  type Workspace,
  type WorkspaceId,
} from "@polaris/protocol";
import { Clearing, type Harness, Scene } from "@polaris/ui";
import { useState } from "react";
import { newSessionId } from "../../../commands.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { useApp } from "../../../shell/hooks.ts";
import { useUploads } from "../../attachments/index.ts";
import { useSettings, withSavedModels } from "../../settings/index.ts";
import { send } from "../dispatch.ts";
import {
  defaultHarness,
  HarnessChip,
  NoHarnessChip,
  noneReady,
  HarnessChoiceRow,
  type ModelChoice,
  SetupNote,
  useAvailability,
  useSignIn,
} from "../../harness/index.ts";
import { hasCapability, useHost } from "../hooks.ts";
import { tildePath } from "../model/format.ts";
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
import { PermissionChip, WhereLine } from "./placement.tsx";

export interface NewSessionPageProps {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  /** The session exists (its feed may still be catching up): open it. */
  readonly onStarted: (sessionId: SessionId) => void;
  /** Esc leaves the page without starting anything. */
  readonly onCancel?: (() => void) | undefined;
}

type Models = Readonly<Partial<Record<Harness, ModelChoice | null>>>;

interface Choices {
  readonly choice: HarnessChoice | null;
  /** The chosen Harness is ready (or the Host couldn't say). */
  readonly startable: boolean;
  readonly models: Models;
  readonly permissionMode: PermissionMode;
  readonly placement: PlacementChoice;
  readonly fork: ForkSourceValue | null;
}

/** The Harness the session runs on: the chosen one, or the forked session's. */
const harnessOf = (choices: Pick<Choices, "choice" | "fork">): Harness | null => {
  if (choices.choice === null) return null;

  if (choices.choice.kind === "harness") return choices.choice.harness;
  const kind = choices.fork?.session.harness ?? "";

  return isKnownHarness(kind) ? kind : null;
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

  if (harness === null || !choices.startable) return null;
  const attachments = ui.attachments.map((a) => a.id);
  const model = choices.models[harness] ?? null;

  if (choices.choice?.kind === "fork") {
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

/** The composer's mono hint: the branch a new Worktree will take, once there's a prompt. */
const branchLabel = (placement: PlacementChoice, choice: HarnessChoice | null, draft: string) => {
  if (placement.kind !== "new-worktree" || choice?.kind === "fork") return undefined;

  return draft.trim() === "" ? "new worktree" : placement.branch;
};

export const NewSessionPage = ({
  hostKey,
  workspaceId,
  onStarted,
  onCancel,
}: NewSessionPageProps) => {
  const host = useHost(hostKey);
  const hostModel = useApp((s) => s.hostModels[hostKey]) ?? emptyHostModel;
  const workspace = hostModel.workspaces.get(workspaceId);
  const key = uiKey(hostKey, `new:${workspaceId}`);
  const ui = useSessionUi(key);
  const [picked, setPicked] = useState<HarnessChoice | null>(null);
  const [models, setModels] = useState<Models>({});
  const { options, loading } = useAvailability(hostKey);
  const signIn = useSignIn(hostKey);
  const [permissionPick, setPermissionMode] = useState<PermissionMode | null>(null);
  const defaults = useSettings((s) => s.sessionDefaults);
  const [placement, setPlacement] = useState<PlacementChoice | null>(null);
  const [forkSession, setForkSession] = useState<SessionId | null>(null);
  const [fork, setFork] = useState<ForkSourceValue | null>(null);
  const [busy, setBusy] = useState(false);

  const { upload, uploads } = useUploads(
    { hostKey, workspaceId, sessionId: null, copyTo: null },
    (staged) => patchSessionUi(key, (u) => ({ attachments: [...u.attachments, staged] }))
  );

  if (workspace === undefined) return <Scene className="h-full flex-1" data-testid="new-session" />;
  const where = placement ?? defaultPlacement(workspace);
  const fallback = defaultHarness(options);

  const choice: HarnessChoice | null =
    picked ?? (fallback === null ? null : { kind: "harness", harness: fallback });

  const option = options.find((o) => choice?.kind === "harness" && o.kind === choice.harness);

  const chosen = harnessOf({ choice, fork });

  const permissionMode =
    permissionPick ??
    (chosen === null ? undefined : defaults[chosen]?.permissionMode) ??
    "supervised";

  const choices: Choices = {
    choice,
    startable: option?.startable ?? choice?.kind === "fork",
    models: withSavedModels(models, defaults),
    permissionMode,
    placement: where,
    fork,
  };

  const harness = chosen;
  // No Harness chosen (none ready, or still checking): a neutral composer, never @claude.
  const hue: Harness | null = harness ?? option?.kind ?? null;
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
          harness={hue ?? ""}
          autoFocus
          picker={
            hue === null ? (
              <NoHarnessChip loading={loading} />
            ) : (
              <HarnessChip
                hostKey={hostKey}
                harness={hue}
                model={choices.models[hue]?.model ?? null}
                effort={choices.models[hue]?.effort ?? null}
                disabled={!choices.startable}
                onModel={(next) => setModels({ ...models, [hue]: next })}
                harnesses={{
                  onPick: (o) => setPicked({ kind: "harness", harness: o.kind }),
                  verb: (o) => o.name,
                }}
              />
            )
          }
          tools={<PermissionChip value={permissionMode} onChange={setPermissionMode} />}
          value={ui.draft}
          onChange={(text) => patchSessionUi(key, () => ({ draft: text }))}
          onSubmit={submit}
          canSubmit={canSubmit}
          placeholder="Describe the change"
          onEscape={onCancel}
          attachments={ui.attachments}
          uploads={uploads}
          onFiles={hasCapability(host, "attachments.stage") ? upload : undefined}
          onRemoveAttachment={(a) =>
            patchSessionUi(key, (u) => ({ attachments: u.attachments.filter((x) => x !== a) }))
          }
          branch={branchLabel(shown, choice, ui.draft)}
          prominentSend
        />
        <HarnessChoiceRow
          hostKey={hostKey}
          options={options}
          picked={choices.models}
          value={choice}
          onChange={setPicked}
          canFork={hasCapability(host, "session.fork")}
          loading={loading}
          onSignIn={signIn.begin}
        />
        {option !== undefined && !option.startable && !noneReady(options) ? (
          <SetupNote option={option} onSignIn={signIn.begin} />
        ) : null}
        {signIn.dialog}
        {choice?.kind === "fork" ? (
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
