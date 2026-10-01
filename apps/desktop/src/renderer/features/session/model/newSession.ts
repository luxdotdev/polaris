/**
 * The new-session page's choices and the `StartSession` (or `ForkSession`)
 * they become: where it runs, which Harness, the permission mode and Model.
 */
import type {
  AttachmentId,
  Command,
  HarnessKind,
  PermissionMode,
  SessionId,
  SessionPlacement,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import { Match } from "effect";
import { Commands, Placement } from "../../../commands.ts";
import type { ModelChoice } from "../../harness/model/models.ts";

export type PlacementChoice =
  | { readonly kind: "in-place" }
  | { readonly kind: "new-worktree"; readonly branch: string; readonly base: string | null }
  | { readonly kind: "existing"; readonly path: string; readonly branch: string | null };

export type { HarnessChoice } from "../../harness/model/choice.ts";

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
/**
 * `head` is the Workspace's checked-out branch: a new Worktree with no base picked starts
 * there, so the line names it ("on a new worktree from main").
 */
export const placementPhrase = (choice: PlacementChoice, head: string | null = null): string =>
  Match.value(choice).pipe(
    Match.discriminatorsExhaustive("kind")({
      "in-place": () => "in place",
      "new-worktree": (c) => {
        const base = c.base ?? head;

        return base === null ? "on a new worktree" : `on a new worktree from ${base}`;
      },
      existing: (c) => `on the worktree ${c.branch ?? c.path}`,
    })
  );

/** " alongside 2 other sessions": the directory is shared, which is fine; empty when it isn't. */
export const sharingPhrase = (others: number): string =>
  others === 0 ? "" : ` alongside ${others} other session${others === 1 ? "" : "s"}`;

/** The directory a placement works in, when it is known before the session starts. */
export const placementDir = (choice: PlacementChoice, workspacePath: string): string | null =>
  Match.value(choice).pipe(
    Match.discriminatorsExhaustive("kind")({
      "in-place": () => workspacePath,
      "new-worktree": () => null,
      existing: (c) => c.path,
    })
  );

/** DESIGN.md, New session: one line saying where it runs (Host, path, Worktree). */
export const whereLine = (
  hostLabel: string,
  path: string,
  choice: PlacementChoice,
  head: string | null = null,
  others = 0
) => `Runs on ${hostLabel} in ${path}, ${placementPhrase(choice, head)}${sharingPhrase(others)}.`;

/** A branch name a new Worktree can take: git's rules, loosely (no spaces, no `..`). */
export const isBranchName = (branch: string): boolean => {
  const b = branch.trim();

  return b !== "" && !/\s|\.\.|[~^:?*[\\]|^[-/]|[/.]$|@\{/.test(b);
};

export interface StartInput {
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly harness: HarnessKind;
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

/**
 * Where a new session works unless the user picks: the Workspace directory, or a new
 * Worktree when Settings asks for one and the Workspace is a git repository.
 */
export const defaultPlacement = (isGitRepo: boolean, newWorktree: boolean): PlacementChoice =>
  isGitRepo && newWorktree
    ? { kind: "new-worktree", branch: "", base: null }
    : { kind: "in-place" };

export const DEFAULT_BRANCH_PREFIX = "polaris/";

const BRANCH_WORDS = 5;

const SUFFIX_LENGTH = 4;

/**
 * A branch for a new Worktree: the prefix (Settings → Sessions), the prompt's first words and
 * the session's id, so the same prompt twice never names the same branch: "polaris/fix-the-login-form-3f9a".
 */
export const branchFromPrompt = (
  prompt: string,
  sessionId: SessionId,
  prefix = DEFAULT_BRANCH_PREFIX
): string => {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, BRANCH_WORDS);

  const suffix = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, SUFFIX_LENGTH);

  return `${prefix}${[...(words.length === 0 ? ["session"] : words), suffix].join("-")}`;
};

/** A new worktree with no branch named yet takes one from the prompt. */
export const resolvePlacement = (
  placement: PlacementChoice,
  prompt: string,
  sessionId: SessionId,
  prefix = DEFAULT_BRANCH_PREFIX
): PlacementChoice =>
  placement.kind === "new-worktree" && placement.branch === ""
    ? { ...placement, branch: branchFromPrompt(prompt, sessionId, prefix) }
    : placement;

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
