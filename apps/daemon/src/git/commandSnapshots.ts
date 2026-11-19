/**
 * Working-tree snapshots around one shell command (ADR 0117): a tree before and a tree
 * after, through Polaris's own index, and what differs between them. No commit, no ref.
 */
import { checkpointRef } from "./checkpointRefs.ts";
import { runGitRaw } from "./git.ts";
import { snapshotTree, type TreeSnapshot } from "./snapshot.ts";
import { type TreeChanges, treeChanges } from "./treeChanges.ts";

/** Whose command it is, and where: the session's directory and the Turn in flight. */
export interface CommandScope {
  readonly cwd: string;
  readonly sessionId: string;
  readonly turnId: string | null;
}

export interface CommandSnapshotOptions {
  /**
   * How long a command waits for its snapshot, and how long a snapshot may take before the
   * tree counts as too large for one before every command.
   */
  readonly budgetMs?: number;
  /** A snapshot slower than this stops snapshots of that tree for `retryMs`. */
  readonly offMs?: number;
  readonly retryMs?: number;
  readonly snapshot?: (cwd: string) => Promise<TreeSnapshot | null>;
  readonly now?: () => number;
}

/** See ADR 0117 for the measurements behind these. */
export const COMMAND_SNAPSHOT_BUDGET_MS = 400;

const OFF_MS = 2_500;

const RETRY_MS = 10 * 60_000;

/** Commands that started and never ended (declined, lost) are forgotten past this many. */
const MAX_OPEN = 256;

/**
 * `patches`: a snapshot before and after each command. `names`: one after it, compared
 * with the Turn's last. `off`: none until `retryAt`.
 */
interface TreeState {
  mode: "patches" | "names" | "off";
  retryAt: number;
  /** The last tree snapshotted here, and the Turn it was taken in. */
  last: { readonly tree: string; readonly turn: string | null } | null;
}

interface Open {
  readonly scope: CommandScope;
  readonly state: TreeState;
  /** The snapshot before the command; null when none was started. */
  readonly before: Promise<TreeSnapshot | null> | null;
  /** Whether `before` finished before the command was let go. */
  timely: boolean;
}

const decoder = new TextDecoder();

/** The tree of the Turn's `before` checkpoint; null when there is none (yet). */
const turnBeforeTree = async (root: string, scope: CommandScope): Promise<string | null> => {
  if (scope.turnId === null) return null;
  const ref = checkpointRef(scope.sessionId, scope.turnId, "before");
  const found = await runGitRaw(root, ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`]);

  return found.code === 0 ? decoder.decode(found.stdout).trim() || null : null;
};

const turnKey = (scope: CommandScope) =>
  scope.turnId === null ? null : `${scope.sessionId}:${scope.turnId}`;

export class CommandSnapshots {
  private readonly budgetMs: number;
  private readonly offMs: number;
  private readonly retryMs: number;
  private readonly snapshot: (cwd: string) => Promise<TreeSnapshot | null>;
  private readonly now: () => number;
  private readonly trees = new Map<string, TreeState>();
  private readonly open = new Map<string, Open>();

  constructor(options: CommandSnapshotOptions = {}) {
    this.budgetMs = options.budgetMs ?? COMMAND_SNAPSHOT_BUDGET_MS;
    this.offMs = options.offMs ?? OFF_MS;
    this.retryMs = options.retryMs ?? RETRY_MS;
    this.snapshot = options.snapshot ?? snapshotTree;
    this.now = options.now ?? Date.now;
  }

  /** How this tree is snapshotted now (tests, the bench). */
  modeOf(cwd: string): TreeState["mode"] {
    return this.stateOf(cwd).mode;
  }

  private stateOf(cwd: string): TreeState {
    const known = this.trees.get(cwd);

    if (known !== undefined) return known;
    const state: TreeState = { mode: "patches", retryAt: 0, last: null };
    this.trees.set(cwd, state);

    return state;
  }

  /** A snapshot's own time decides how the tree's next command is snapshotted. */
  private measure(state: TreeState, snapshot: TreeSnapshot | null): void {
    if (snapshot === null) return;

    if (snapshot.ms > this.offMs) {
      state.mode = "off";
      state.retryAt = this.now() + this.retryMs;
    } else {
      state.mode = snapshot.ms > this.budgetMs ? "names" : "patches";
    }
  }

  private take(state: TreeState, cwd: string): Promise<TreeSnapshot | null> {
    return this.snapshot(cwd).then(
      (snapshot) => {
        this.measure(state, snapshot);

        return snapshot;
      },
      () => null
    );
  }

  /**
   * Before the command runs: resolves once the tree is snapshotted, or after the budget,
   * whichever is first, so a command never waits longer than that.
   */
  async started(id: string, scope: CommandScope): Promise<void> {
    const state = this.stateOf(scope.cwd);

    if (state.mode === "off") {
      if (this.now() < state.retryAt) return;
      // Try again without holding the command: its snapshot after says how fast the tree is now.
      state.mode = "names";
    }

    if (this.open.size >= MAX_OPEN) this.open.delete(this.open.keys().next().value!);

    if (state.mode === "names") {
      this.open.set(id, { scope, state, before: null, timely: false });

      return;
    }

    const before = this.take(state, scope.cwd);
    const entry: Open = { scope, state, before, timely: false };
    this.open.set(id, entry);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), this.budgetMs);
    });

    const first = await Promise.race([before, late]);
    clearTimeout(timer);
    entry.timely = first !== "late" && first !== null;

    // The command now runs while the snapshot does: its own changes may be in that tree.
    if (first === "late" && state.mode === "patches") state.mode = "names";
  }

  /** Whether the command's changes come from snapshots of its own: worth a short wait. */
  isPrecise(id: string): boolean {
    return this.open.get(id)?.timely === true;
  }

  /**
   * After the command ended: what the working tree gained, lost or had rewritten meanwhile.
   * Null when no snapshots were taken around it, or there is nothing to compare with.
   */
  async ended(id: string): Promise<TreeChanges | null> {
    const entry = this.open.get(id);

    if (entry === undefined) return null;
    this.open.delete(id);
    const { scope, state } = entry;
    const before = await entry.before;
    const after = await this.take(state, scope.cwd);

    if (after === null) return null;
    const turn = turnKey(scope);
    const last = state.last;
    state.last = { tree: after.tree, turn };

    try {
      if (entry.timely && before !== null)
        return await treeChanges(after.root, before.tree, after.tree, { patches: true });

      // Names from the Turn's own diff: against its last snapshot, else its `before` checkpoint.
      const base =
        last !== null && last.turn === turn && turn !== null
          ? last.tree
          : await turnBeforeTree(after.root, scope);

      return base === null
        ? null
        : await treeChanges(after.root, base, after.tree, { patches: false });
    } catch {
      // A tree gc pruned, or a repository that went: the command shows without its files.
      return null;
    }
  }
}

/** The Daemon's own: trees are shared by every session working in them. */
export const commandSnapshots = new CommandSnapshots();
