/**
 * What the composer does in each Session State, and the commands it sends.
 * Mirrors the session machine's rules (`apps/daemon/src/engine/session.ts`) so
 * the composer never offers what the Daemon would refuse; a refusal still wins.
 */
import type {
  AttachmentId,
  Command,
  PermissionMode,
  SessionId,
  SessionState,
  TurnId,
  TurnStatus,
} from "@polaris/protocol";
import { Commands } from "../../../commands.ts";

export type ComposerMode =
  /** A new Turn: `SendTurn`. */
  | { readonly kind: "send" }
  /** Guidance for the Turn in flight: `Steer`. */
  | { readonly kind: "steer" }
  /** Nothing can be sent now; `reason` says why, as the placeholder. */
  | { readonly kind: "blocked"; readonly reason: string };

export interface ComposerContext {
  readonly state: SessionState;
  readonly lastTurn: TurnStatus | null;
  readonly pendingApprovals: number;
  /** The Daemon has `session.steer`. */
  readonly canSteer: boolean;
}

const blocked = (reason: string): ComposerMode => ({ kind: "blocked", reason });

const SEND: ComposerMode = { kind: "send" };

/** The composer's mode; the same checks, in the same order, as the machine's `takesTurn`. */
export const composerMode = (ctx: ComposerContext): ComposerMode => {
  if (ctx.state === "archived") return blocked("Unarchive this session to send a turn");

  if (ctx.state === "in-terminal") return blocked("In terminal · take it back to send a turn");

  if (ctx.lastTurn === "working") {
    if (ctx.pendingApprovals > 0) return blocked("Answer the request above to go on");

    return ctx.canSteer ? { kind: "steer" } : blocked("Wait for this turn, or stop it");
  }

  if (ctx.state === "starting") return blocked("Starting…");

  if (ctx.state === "needs-you" && ctx.pendingApprovals > 0)
    return blocked("Answer the request above to go on");

  return SEND;
};

export const placeholderFor = (mode: ComposerMode): string => {
  if (mode.kind === "blocked") return mode.reason;

  return mode.kind === "steer" ? "Steer this turn" : "Ask for a change";
};

export interface Draft {
  readonly text: string;
  readonly attachments: ReadonlyArray<AttachmentId>;
}

/** The command a submitted draft becomes, or null when there is nothing to send. */
export const submitCommand = (
  mode: ComposerMode,
  sessionId: SessionId,
  draft: Draft
): Command | null => {
  const text = draft.text.trim();

  if (mode.kind === "blocked") return null;

  if (mode.kind === "steer") return text === "" ? null : Commands.Steer({ sessionId, text });

  if (text === "" && draft.attachments.length === 0) return null;

  return Commands.SendTurn({ sessionId, prompt: text, attachments: draft.attachments });
};

/** Esc while Working interrupts the Turn in flight; otherwise it does nothing. */
export const interruptCommand = (sessionId: SessionId, lastTurn: TurnStatus | null) =>
  lastTurn === "working" ? Commands.Interrupt({ sessionId }) : null;

export const continueCommand = (sessionId: SessionId) => Commands.Continue({ sessionId });

export const renameCommand = (sessionId: SessionId, title: string): Command | null => {
  const trimmed = title.trim();

  return trimmed === "" ? null : Commands.RenameSession({ sessionId, title: trimmed });
};

export const permissionCommand = (sessionId: SessionId, permissionMode: PermissionMode) =>
  Commands.SetPermissionMode({ sessionId, permissionMode });

export const archiveCommand = (sessionId: SessionId) =>
  Commands.ArchiveSession({ sessionId, deleteMergedBranch: false });

export interface ForkInput {
  readonly sessionId: SessionId;
  readonly fromSessionId: SessionId;
  readonly fromTurnId: TurnId;
  readonly harness: string;
  readonly model: string | null;
  readonly effort: string | null;
}

export const forkCommand = (input: ForkInput) => Commands.ForkSession(input);

/** Permission modes as the picker lists them, least trust first. */
export const PERMISSION_MODES: ReadonlyArray<{
  readonly mode: PermissionMode;
  readonly label: string;
  readonly detail: string;
}> = [
  { mode: "supervised", label: "Supervised", detail: "Asks before edits and commands" },
  { mode: "auto-edits", label: "Auto edits", detail: "Edits freely, asks before commands" },
  { mode: "auto", label: "Auto", detail: "Asks only for risky actions" },
  { mode: "full-access", label: "Full access", detail: "Never asks" },
];

export const permissionLabel = (mode: PermissionMode): string =>
  PERMISSION_MODES.find((p) => p.mode === mode)?.label ?? mode;
