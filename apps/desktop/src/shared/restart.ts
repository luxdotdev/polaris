/**
 * Restart daemon over IPC (Settings → Hosts' Daemon card, DESIGN.md HS-D4): the confirm's
 * preview and the restart's outcome. While it runs, the Host's Connection State (its
 * `hosts` view) reads Reconnecting; these answer what the subscription can't.
 */

/** Which service manager restarts the Daemon, for "launchd started it again". */
export type ServiceManagerView = "launchd" | "systemd" | "supervisor" | "task-scheduler";

export interface RestartWorkingSessionView {
  readonly sessionId: string;
  readonly title: string;
  readonly harness: string;
  /** The Turn in flight, 1-based ("Working · turn 12"). */
  readonly turn: number;
}

export interface RestartPreviewView {
  /** False for a remote Host that isn't connected: "Restarts once Mac Studio is connected". */
  readonly available: boolean;
  /** Why not, as copy; null when available. */
  readonly unavailableReason: string | null;
  /** What it would interrupt; null when the Daemon can't say (not connected, older). */
  readonly interrupts: {
    readonly workingSessions: ReadonlyArray<RestartWorkingSessionView>;
    readonly terminals: number;
    readonly pendingApprovals: number;
  } | null;
}

export type RestartDaemonResult =
  /** Back: a new Daemon answers (its `startedAt` differs). */
  | {
      readonly outcome: "back";
      readonly manager: ServiceManagerView;
      readonly command: string;
      readonly previousStartedAt: string | null;
      readonly startedAt: string;
      /** Turns ended cleanly before the stop; null when that step couldn't run. */
      readonly interruptedTurns: number | null;
    }
  /** A remote Host that isn't connected; nothing ran. */
  | { readonly outcome: "refused"; readonly message: string }
  /** Failed: the service manager's own output and the exact command ("Copy command"). */
  | {
      readonly outcome: "failed";
      readonly stage: "channel" | "no-service" | "service" | "start";
      readonly message: string;
      readonly manager: ServiceManagerView | null;
      readonly command: string | null;
      readonly output: string;
      readonly exitCode: number | null;
      /** "Reinstall service" applies (it reruns the service install, `machines.startDaemon`). */
      readonly reinstall: boolean;
    }
  /** Windows: another Polaris home owns the sign-in task; nothing changed. */
  | {
      readonly outcome: "task-conflict";
      readonly task: string;
      readonly otherHome: string | null;
      readonly message: string;
    };
