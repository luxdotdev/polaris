/**
 * The files a Bash call changed (ADR 0117): Agent SDK hooks snapshot the working tree before
 * and after each call that isn't plainly read-only, and the changes join the call's item.
 */
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import type { ItemFileChange, TurnId } from "@polaris/protocol";
import { Option, Schema } from "effect";
import { type CommandSnapshots, commandSnapshots } from "../../git/commandSnapshots.ts";
import type { HarnessEvent, OpenOptions } from "../HarnessDriver.ts";
import { isReadOnlyCommand } from "../readOnlyCommand.ts";

/** What a command's item carries: the listed files, and how many more changed. */
export interface CommandChanges {
  readonly changes: ReadonlyArray<ItemFileChange>;
  readonly more: number;
}

/** The item fields for `changes`; none when nothing changed. */
export const commandChangeFields = (found: CommandChanges | undefined) => {
  if (found === undefined || found.changes.length === 0) return {};

  return found.more > 0
    ? { changes: found.changes, moreChanges: found.more }
    : { changes: found.changes };
};

/**
 * Joins a command's changes to its result, whichever comes first: changes that arrive first
 * wait for the result; a result that arrives first is kept, to complete again with them.
 */
export class CommandChangeJoin<Completed> {
  private readonly tracked = new Set<string>();
  private readonly early = new Map<string, CommandChanges>();
  private readonly completed = new Map<string, Completed>();

  /** The call's working tree is being snapshotted: its changes will follow. */
  track(id: string): void {
    this.tracked.add(id);
  }

  /** The call's result arrived: its changes when they are here, else `completed` waits for them. */
  onResult(id: string, completed: Completed): CommandChanges | undefined {
    const changes = this.early.get(id);
    this.early.delete(id);

    if (changes === undefined && this.tracked.has(id)) this.completed.set(id, completed);
    this.tracked.delete(id);

    return changes;
  }

  /** The call's changes arrived: the completed call to send again with them, when it was first. */
  onChanges(id: string, changes: CommandChanges | null): Completed | null {
    const completed = this.completed.get(id) ?? null;
    this.completed.delete(id);

    if (completed !== null)
      return changes === null || changes.changes.length === 0 ? null : completed;

    if (!this.tracked.has(id)) return null;

    if (changes === null) this.tracked.delete(id);
    else this.early.set(id, changes);

    return null;
  }

  /** The Turn ended: whatever was still waiting is dropped. */
  clear(): void {
    this.tracked.clear();
    this.early.clear();
    this.completed.clear();
  }
}

const BashInput = Schema.Struct({
  command: Schema.String,
  run_in_background: Schema.optionalKey(Schema.Boolean),
});

const decodeBash = Schema.decodeUnknownOption(BashInput);

/** How long the next model call waits for a command's changes; they still land when later. */
const AFTER_WAIT_MS = 2_000;

const within = <A>(work: Promise<A>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/** The translator's side of the join: it learns of a snapshotted call, then of its changes. */
interface CommandItems {
  readonly trackCommand: (id: string) => void;
  readonly onCommandChanges: (id: string, changes: CommandChanges | null) => Array<HarnessEvent>;
}

/**
 * Adds the Bash hooks to `options`: the call is tracked before the command runs, and `emit`
 * gets what its changes complete once they are read. A background command isn't snapshotted:
 * it outlives its call. `snapshots` is the Daemon's own unless a test brings one.
 */
export const applyCommandChangeHooks = (
  options: Options,
  session: Pick<OpenOptions, "cwd" | "sessionId" | "readOnly">,
  items: CommandItems,
  emit: (events: ReadonlyArray<HarnessEvent>) => void,
  currentTurn: () => TurnId | null,
  snapshots: CommandSnapshots = commandSnapshots
): void => {
  if (session.readOnly === true) return;

  const deliver = (id: string, changes: CommandChanges | null) =>
    emit(items.onCommandChanges(id, changes));

  const before: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const bash = Option.getOrNull(decodeBash(input.tool_input));

    if (bash === null || bash.run_in_background === true || isReadOnlyCommand(bash.command))
      return {};

    items.trackCommand(input.tool_use_id);

    await snapshots.started(input.tool_use_id, {
      cwd: session.cwd,
      sessionId: session.sessionId,
      turnId: currentTurn(),
    });

    return {};
  };

  const after: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure")
      return {};
    const id = input.tool_use_id;
    // On a tree too large to snapshot quickly, the names follow without holding the Turn.
    const wait = snapshots.isPrecise(id) ? AFTER_WAIT_MS : 0;

    const delivered = snapshots.ended(id).then(
      (changes) => deliver(id, changes),
      () => deliver(id, null)
    );

    if (wait > 0) await within(delivered, wait);

    return {};
  };

  const add = (event: "PreToolUse" | "PostToolUse" | "PostToolUseFailure", hook: HookCallback) => [
    ...(options.hooks?.[event] ?? []),
    { matcher: "Bash", hooks: [hook] },
  ];

  options.hooks = {
    ...options.hooks,
    PreToolUse: add("PreToolUse", before),
    PostToolUse: add("PostToolUse", after),
    PostToolUseFailure: add("PostToolUseFailure", after),
  };
};
