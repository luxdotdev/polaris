/**
 * "Open as agent session": the card's exchange becomes a normal Agent Session in the file's
 * Workspace. The selected text is staged as an attachment (its source pill), and the prompt
 * carries the selection and any proposal (`inlineSessionPrompt`). No new RPC: `StartSession`.
 */
import {
  type InlinePatch,
  type InlineRequest,
  inlineSessionPrompt,
  type PermissionMode,
  type SessionId,
} from "@polaris/protocol";
import { Commands, newSessionId, Placement } from "../../../commands.ts";
import { settingsStore } from "../../settings/index.ts";
import { polaris } from "../../bridge.ts";
import { send } from "../../session/dispatch.ts";
import { rangeLabel } from "../model/patch.ts";

const lineOf = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

/** "reconnect.ts lines 10–19": the attachment's name. */
export const sourceName = (request: InlineRequest): string => {
  const name = request.path.slice(request.path.lastIndexOf("/") + 1);
  const { from, to } = request.selection;

  return `${name} ${rangeLabel(lineOf(request.content, from), lineOf(request.content, to))}`;
};

/** Starts the session; its id once the Daemon has it, or null after a refusal (shown as a toast). */
export const openAsSession = async (
  hostKey: string,
  request: InlineRequest,
  patch: InlinePatch | null,
  /** The Worktree holding the file, when it isn't the Workspace's own folder. */
  worktree: string | null
): Promise<SessionId | null> => {
  const sessionId = newSessionId();
  const { from, to } = request.selection;

  const staged = await polaris().request("attachments.stage", {
    hostKey,
    sessionId: null,
    workspaceId: request.workspaceId,
    name: sourceName(request),
    mimeType: "text/plain",
    bytes: new TextEncoder().encode(request.content.slice(from, to)),
  });

  const permissionMode: PermissionMode =
    settingsStore.getState().sessionDefaults[request.harness]?.permissionMode ?? "supervised";

  const started = await send(
    hostKey,
    Commands.StartSession({
      sessionId,
      workspaceId: request.workspaceId,
      harness: request.harness,
      placement:
        worktree === null ? Placement.InPlace() : Placement.ExistingWorktree({ path: worktree }),
      permissionMode,
      model: request.model,
      effort: request.effort,
      prompt: inlineSessionPrompt(request, patch),
      attachments: staged.ok ? [staged.value.id] : [],
    }),
    "Couldn't start the session"
  );

  return started ? sessionId : null;
};
