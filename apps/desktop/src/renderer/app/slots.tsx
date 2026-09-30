/**
 * The shell's slots: the views other features fill. The shell owns layout,
 * selection and keyboard; a feature owns what renders inside its slot. To
 * wire a feature in, replace its default below with the feature's component.
 */
import type { SessionId, WorkspaceId } from "@polaris/protocol";
import type { ComponentType, ReactElement } from "react";
import { NeedsYouHover, NeedsYouInbox } from "../features/needs-you/index.ts";
import { NewSessionPage, SessionIntent, SessionOutput } from "../features/session/index.ts";
import { WorkspaceStage } from "../features/empty/index.ts";
import { JumpMenu } from "../features/jump/index.ts";

/** A selected Agent Session: which Host it lives on and its id. */
export interface SessionSlotProps {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

/** A Workspace in context (new session, empty states). */
export interface WorkspaceSlotProps {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
}

export interface JumpMenuProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export interface NewSessionProps extends WorkspaceSlotProps {
  /** Call once the session is started; the shell selects it. */
  readonly onStarted: (sessionId: SessionId) => void;
  readonly onCancel: () => void;
}

/** Wraps a session row or Workspace chip that needs you with its hover card. */
export interface NeedsYouHoverSlotProps {
  readonly hostKey: string;
  readonly sessionId?: SessionId;
  readonly workspaceId?: WorkspaceId;
  readonly children: ReactElement;
}

export interface ShellSlots {
  /** The Intent column (448px): the conversation and composer of the selected session. */
  readonly SessionIntent: ComponentType<SessionSlotProps>;
  /** The Output column (the rest): Changes, Preview, Files, Risk for the selected session. */
  readonly SessionOutput: ComponentType<SessionSlotProps>;
  /** Spans Intent and Output while the user starts a session in a Workspace. */
  readonly NewSession: ComponentType<NewSessionProps>;
  /** Spans Intent and Output when the Workspace has no session selected. */
  readonly NoSession: ComponentType<WorkspaceSlotProps>;
  /** The sidebar's "Needs you" view, across every Host. */
  readonly NeedsYouInbox: ComponentType;
  /** The K jump menu; the shell owns its open state (`useShellActions().openJump`). */
  readonly JumpMenu: ComponentType<JumpMenuProps>;
  /** The Needs You hover card around a waiting session's row or its Workspace chip. */
  readonly NeedsYouHover: ComponentType<NeedsYouHoverSlotProps>;
}

export const slots: ShellSlots = {
  SessionIntent,
  SessionOutput,
  NewSession: NewSessionPage,
  NoSession: WorkspaceStage,
  NeedsYouInbox,
  JumpMenu,
  NeedsYouHover,
};
