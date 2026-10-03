/**
 * Background tasks as the UI words them (DESIGN.md, Waiting on background tasks):
 * an Idle session with tasks still running is waiting on them, and a Turn the
 * Harness started itself says which reports woke it.
 */
import type {
  BackgroundTask,
  BackgroundTaskKind,
  BackgroundTaskRef,
  SessionState,
  TurnTrigger,
} from "@polaris/protocol";

type Counts = Readonly<Record<BackgroundTaskKind, number>>;

const countKinds = (tasks: ReadonlyArray<BackgroundTaskRef>): Counts => ({
  subagent: tasks.filter((t) => t.kind === "subagent").length,
  command: tasks.filter((t) => t.kind === "command").length,
});

const NOUN: Readonly<Record<BackgroundTaskKind, string>> = {
  subagent: "subagent",
  command: "command",
};

/** "a subagent" alone, "2 subagents"; numerals for both kinds when mixed ("1 subagent"). */
const counted = (kind: BackgroundTaskKind, n: number, mixed: boolean) =>
  n === 1 && !mixed ? `a ${NOUN[kind]}` : `${n} ${NOUN[kind]}${n === 1 ? "" : "s"}`;

const upperFirst = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** "Waiting on 2 subagents", "Waiting on a command", "Waiting on 1 subagent and 1 command". */
export const waitingPhrase = (tasks: ReadonlyArray<BackgroundTaskRef>): string => {
  const { subagent, command } = countKinds(tasks);
  const mixed = subagent > 0 && command > 0;

  const parts = [
    ...(subagent > 0 ? [counted("subagent", subagent, mixed)] : []),
    ...(command > 0 ? [counted("command", command, mixed)] : []),
  ];

  return `Waiting on ${parts.join(" and ")}`;
};

/** An Idle session with background tasks still running: waiting on them, not idle. */
export const waitingOn = (session: {
  readonly state: SessionState;
  readonly backgroundTasks: ReadonlyArray<BackgroundTask>;
}): ReadonlyArray<BackgroundTask> => (session.state === "idle" ? session.backgroundTasks : []);

const VERB: Readonly<Record<BackgroundTaskKind, string>> = {
  subagent: "reported",
  command: "finished",
};

/** "2 subagents reported", "A command finished", "A subagent reported and 2 commands finished". */
export const triggerPhrase = (trigger: TurnTrigger): string => {
  const counts = countKinds(trigger.tasks);

  const parts = (["subagent", "command"] as const).flatMap((kind) => {
    const n = counts[kind];

    return n === 0 ? [] : [`${counted(kind, n, false)} ${VERB[kind]}`];
  });

  return parts.length === 0 ? "Continued on its own" : upperFirst(parts.join(" and "));
};
