/** The user sees the concrete action before granting session authority. */
import { Command, type SessionId } from "@polaris/protocol";
import type { ReadModel } from "../store/model.ts";
import type { SessionAction } from "./sessionGrantPolicy.ts";

const sessionName = (model: ReadModel, id: SessionId) =>
  model.sessions.get(id)?.session.title || id;

const promptPreview = (prompt: string) =>
  prompt.length > 600 ? `${prompt.slice(0, 600)}…` : prompt;

export const grantActionDescription = (model: ReadModel, action: SessionAction): string => {
  const fallback = `${action.rpc}${action.settingKey === undefined ? "" : ` · ${action.settingKey}`}`;

  if (action.command === undefined) return fallback;

  return Command.matchOrElse(
    action.command,
    {
      StartSession: (c) =>
        `Start ${c.harness} in ${model.workspaces.get(c.workspaceId)?.name ?? c.workspaceId} · ${c.permissionMode}\nModel: ${c.model ?? "Harness default"}\n${promptPreview(c.prompt)}`,
      SendTurn: (c) =>
        `Send a turn to ${sessionName(model, c.sessionId)}\n${promptPreview(c.prompt)}`,
      Interrupt: (c) => `Stop the turn in ${sessionName(model, c.sessionId)}`,
      SetModel: (c) =>
        `Set ${sessionName(model, c.sessionId)} to ${c.model ?? "the Harness default model"}`,
      SetPermissionMode: (c) => `Set ${sessionName(model, c.sessionId)} to ${c.permissionMode}`,
    },
    () => fallback
  );
};
