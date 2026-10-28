/**
 * The new agent session sheet's decisions (Paper M6; DESIGN.md, New session): where it runs by
 * default, the lines that say so, the branch a new Worktree takes, and the command Start sends.
 */
import {
  Command,
  type HarnessKind,
  ModelId,
  SessionId,
  SessionPlacement,
  type Workspace,
  type WorkspaceId,
} from "@polaris/protocol";
import { Predicate } from "effect";

/** How this phone reaches a Host (DESIGN.md, Mobile App: Hosts). */
export type Route = "relay" | "network";

/** What the sheet knows about one Host. */
export interface SheetHost {
  readonly hostId: string;
  readonly hostName: string;
  /** Only a connected Host can be chosen. */
  readonly connected: boolean;
  /** Null while the Host's route isn't known. */
  readonly route: Route | null;
  /** The Daemon's home directory, to show paths as `~/…`; null before `hello`. */
  readonly homeDir: string | null;
  readonly workspaces: ReadonlyArray<Workspace>;
  readonly sessions: ReadonlyArray<SessionUse>;
  readonly capabilities: ReadonlyArray<string>;
}

/** The parts of an agent session the sheet's defaults read. */
export interface SessionUse {
  readonly workspaceId: string;
  readonly harness: string;
  readonly updatedAt: string;
}

export interface Target {
  readonly hostId: string;
  readonly workspaceId: string;
}

const visible = (host: SheetHost) => host.workspaces.filter((w) => !w.hidden);

/** The Workspace of the newest session on any connected Host; null when none ran yet. */
export const lastUsedTarget = (hosts: ReadonlyArray<SheetHost>): Target | null => {
  let best: (Target & { readonly at: string }) | null = null;

  for (const host of hosts.filter((h) => h.connected)) {
    const ids = new Set(visible(host).map((w) => String(w.id)));

    for (const s of host.sessions)
      if (ids.has(s.workspaceId) && (best === null || s.updatedAt > best.at))
        best = { hostId: host.hostId, workspaceId: s.workspaceId, at: s.updatedAt };
  }

  return best === null ? null : { hostId: best.hostId, workspaceId: best.workspaceId };
};

/**
 * Where the sheet opens: the Workspace asked for, else the last used one (with its Host), else
 * the first Workspace of the first connected Host.
 */
export const defaultTarget = (
  hosts: ReadonlyArray<SheetHost>,
  workspaceId?: string
): Target | null => {
  const connected = hosts.filter((h) => h.connected);

  if (workspaceId !== undefined) {
    const host = connected.find((h) => visible(h).some((w) => w.id === workspaceId));

    if (host !== undefined) return { hostId: host.hostId, workspaceId };
  }

  const last = lastUsedTarget(hosts);

  if (last !== null) return last;
  const first = connected.find((h) => visible(h).length > 0);
  const workspace = first === undefined ? undefined : visible(first)[0];

  return first === undefined || workspace === undefined
    ? null
    : { hostId: first.hostId, workspaceId: workspace.id };
};

/** When each Harness last ran a session on the Host. */
export const lastUsedHarnesses = (host: SheetHost): ReadonlyMap<string, string> => {
  const used = new Map<string, string>();

  for (const s of host.sessions)
    if ((used.get(s.harness) ?? "") < s.updatedAt) used.set(s.harness, s.updatedAt);

  return used;
};

/** "Runs on Mac Studio · via Polaris Relay", or "· on this network". */
export const routeLine = (host: SheetHost): string => {
  const runsOn = `Runs on ${host.hostName}`;

  if (host.route === "relay") return `${runsOn} · via Polaris Relay`;

  return host.route === "network" ? `${runsOn} · on this network` : runsOn;
};

/** A path under the Host's home as `~/…`. */
export const displayPath = (path: string, homeDir: string | null): string => {
  if (homeDir === null || homeDir === "") return path;

  if (path === homeDir) return "~";

  return path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path;
};

/** Capability a Daemon announces once it has plan mode (ENG-466). */
export const PLAN_MODE_CAPABILITY = "session.plan-mode";

export const hasPlanMode = (host: SheetHost): boolean =>
  host.capabilities.includes(PLAN_MODE_CAPABILITY);

/** The Plan first row's caption: what the session will actually do on this Host. */
export const planCaption = (host: SheetHost): string =>
  hasPlanMode(host) ? "Reads and plans; asks before it edits anything" : "Asks before every edit";

/** Settings → Sessions' default branch prefix on the Desktop App. */
export const BRANCH_PREFIX = "polaris/";

const BRANCH_WORDS = 5;

const SUFFIX_LENGTH = 4;

/** "polaris/fix-the-login-form-3f9a": the prompt's first words and the session's id. */
export const branchFromPrompt = (prompt: string, sessionId: string, prefix = BRANCH_PREFIX) => {
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

/** The New worktree row's caption, off or on. */
export const worktreeCaption = (
  on: boolean,
  workspace: Workspace,
  homeDir: string | null,
  branch: string
): string =>
  on ? `On: works on ${branch}` : `Off: runs in ${displayPath(workspace.path, homeDir)}, in place`;

/** 32 hex digits from `getRandomValues` where the engine has it (Hermes doesn't). */
export const newSessionId = (): SessionId => {
  const bytes = new Uint8Array(16);

  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  return SessionId.make(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
};

export interface StartChoices {
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly harness: HarnessKind;
  readonly model: string | null;
  readonly prompt: string;
  readonly newWorktree: boolean;
}

/** The StartSession command; plan mode waits on ENG-466, so every session starts supervised. */
export const startCommand = (choices: StartChoices): Command =>
  Command.cases.StartSession.make({
    sessionId: choices.sessionId,
    workspaceId: choices.workspaceId,
    harness: choices.harness,
    placement: choices.newWorktree
      ? SessionPlacement.cases.NewWorktree.make({
          branch: branchFromPrompt(choices.prompt, choices.sessionId),
          baseRef: null,
        })
      : SessionPlacement.cases.InPlace.make({}),
    permissionMode: "supervised",
    model: choices.model === null ? null : ModelId.make(choices.model),
    effort: null,
    prompt: choices.prompt.trim(),
    attachments: [],
  });

/** A caught failure's words for one caption line. */
export const failureText = (failure: NonNullable<unknown> | null | undefined): string => {
  if (failure instanceof Error) return failure.message;

  return Predicate.isString(failure) ? failure : "something went wrong";
};
