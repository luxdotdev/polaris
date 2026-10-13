/**
 * What the renderer tells the main process about Needs You, for the menu bar star, the Dock
 * badge and native notifications, and what those send back. Plain data, types only.
 */

/** One pending approval or question, as a notification shows it. */
export interface NeedsYouRequest {
  readonly requestId: string;
  readonly kind: "command" | "file-change" | "tool" | "question";
  readonly title: string;
  readonly detail: string | null;
  /** A question's numbered answers. */
  readonly options: ReadonlyArray<string>;
}

/** A session waiting on the user, on any Host. */
export interface NeedsYouSession {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly workspace: string | null;
  readonly sessionId: string;
  readonly title: string;
  /** The Harness's name ("Claude Code"). */
  readonly harness: string;
  /** Approvals and questions, oldest first; empty for an Interrupted Turn waiting on Continue. */
  readonly requests: ReadonlyArray<NeedsYouRequest>;
}

/** A session mid-Turn or Idle, so main can tell when a Turn ends (Settings → Sessions). */
export interface NeedsYouTurn {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly sessionId: string;
  readonly title: string;
  readonly harness: string;
  readonly state: "working" | "idle";
  /** The latest Turn's prompt, shortened. */
  readonly prompt: string | null;
  /** Polaris started the latest Turn for a Constellation digest: not the user's Turn. */
  readonly digestStarted?: boolean;
}

/** The latest notification an agent sent from a session (MCP `notify`). */
export interface NeedsYouNotification {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
  /** The notification's own id: each is shown once. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface NeedsYouSummary {
  /** Sessions that need you across every Host: the menu bar and Dock count. */
  readonly count: number;
  readonly sessions: ReadonlyArray<NeedsYouSession>;
  /** The session the window shows; no notification for it while the window is focused. */
  readonly focused: { readonly hostKey: string; readonly sessionId: string } | null;
  /** Working and Idle sessions outside Constellations, for Turn notifications; none if absent. */
  readonly turns?: ReadonlyArray<NeedsYouTurn>;
  /** Each session's latest agent notification; none if absent. */
  readonly notifications?: ReadonlyArray<NeedsYouNotification>;
}

/** What the menu bar and notifications ask the renderer to do. */
export type NeedsYouAction =
  | { readonly action: "open"; readonly hostKey: string; readonly sessionId: string }
  | {
      readonly action: "approve" | "deny";
      readonly hostKey: string;
      readonly sessionId: string;
      readonly requestId: string;
    }
  | {
      readonly action: "answer";
      readonly hostKey: string;
      readonly sessionId: string;
      readonly requestId: string;
      readonly text: string;
    };
