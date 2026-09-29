/**
 * The new-session page's choices and the `StartSession` (or `ForkSession`)
 * they become: where it runs, which Harness, the permission mode and Model.
 */
import type {
  AttachmentId,
  Command,
  PermissionMode,
  SessionId,
  SessionPlacement,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import { Match } from "effect";
import { Commands, Placement } from "../../../commands.ts";
import type { ModelChoice } from "./models.ts";

export type PlacementChoice =
  | { readonly kind: "in-place" }
  | { readonly kind: "new-worktree"; readonly branch: string; readonly base: string | null }
  | { readonly kind: "existing"; readonly path: string; readonly branch: string | null };

export type HarnessChoice = "claude" | "codex" | "fork";

export const toPlacement = (choice: PlacementChoice): SessionPlacement =>
  Match.value(choice).pipe(
    Match.discriminatorsExhaustive("kind")({
      "in-place": () => Placement.InPlace(),
      "new-worktree": (c) =>
        Placement.NewWorktree({ branch: c.branch.trim(), baseRef: c.base ?? null }),
      existing: (c) => Placement.ExistingWorktree({ path: c.path }),
    })
  );

/** "on a new worktree from main", "in place", "on the worktree spike/gpui". */
export const placementPhrase = (choice: PlacementChoice): string =>
  Match.value(choice).pipe(
    Match.discriminatorsExhaustive("kind")({
      "in-place": () => "in place",
      "new-worktree": (c) =>
        c.base === null ? "on a new worktree" : `on a new worktree from ${c.base}`,
      existing: (c) => `on the worktree ${c.branch ?? c.path}`,
    })
  );

/** DESIGN.md, New session: one line saying where it runs (Host, path, Worktree). */
export const whereLine = (hostLabel: string, path: string, choice: PlacementChoice) =>
  `Runs on ${hostLabel} in ${path}, ${placementPhrase(choice)}.`;

/** A branch name a new Worktree can take: git's rules, loosely (no spaces, no `..`). */
export const isBranchName = (branch: string): boolean => {
  const b = branch.trim();

  return b !== "" && !/\s|\.\.|[~^:?*[\\]|^[-/]|[/.]$|@\{/.test(b);
};

export interface StartInput {
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly harness: "claude" | "codex";
  readonly placement: PlacementChoice;
  readonly permissionMode: PermissionMode;
  readonly model: ModelChoice | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<AttachmentId>;
}

/** Null until there is a prompt and the placement is valid. */
export const startCommand = (input: StartInput): Command | null => {
  const prompt = input.prompt.trim();

  if (prompt === "" && input.attachments.length === 0) return null;

  if (input.placement.kind === "new-worktree" && !isBranchName(input.placement.branch)) return null;

  return Commands.StartSession({
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    harness: input.harness,
    placement: toPlacement(input.placement),
    permissionMode: input.permissionMode,
    model: input.model?.model ?? null,
    effort: input.model?.effort ?? null,
    prompt,
    attachments: input.attachments,
  });
};

const BRANCH_WORDS = 5;

/** A branch for a new Worktree from the prompt's first words: "polaris/fix-the-login-form". */
export const branchFromPrompt = (prompt: string, fallback: string): string => {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, BRANCH_WORDS);

  return `polaris/${words.length === 0 ? fallback : words.join("-")}`;
};

export interface ForkStartInput {
  readonly sessionId: SessionId;
  readonly fromSessionId: SessionId;
  readonly fromTurnId: TurnId;
  readonly harness: string;
  readonly model: ModelChoice | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<AttachmentId>;
}

/** "Fork a turn": the Fork, then the prompt (if any) as its first Turn. */
export const forkStartCommands = (input: ForkStartInput): ReadonlyArray<Command> => {
  const fork = Commands.ForkSession({
    sessionId: input.sessionId,
    fromSessionId: input.fromSessionId,
    fromTurnId: input.fromTurnId,
    harness: input.harness,
    model: input.model?.model ?? null,
    effort: input.model?.effort ?? null,
  });

  const prompt = input.prompt.trim();

  if (prompt === "" && input.attachments.length === 0) return [fork];

  return [
    fork,
    Commands.SendTurn({ sessionId: input.sessionId, prompt, attachments: input.attachments }),
  ];
};
