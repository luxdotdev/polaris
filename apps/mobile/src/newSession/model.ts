/**
 * The new agent session sheet's decisions (Paper M6; DESIGN.md, New session): where it runs by
 * default, the lines that say so, the permission modes, the branch a new Worktree takes, and the
 * command Start sends.
 */
import {
  type AttachmentId,
  type Capability,
  Command,
  type HarnessKind,
  ModelId,
  PermissionMode,
  permissionModeFor,
  SessionId,
  SessionPlacement,
  type Workspace,
  type WorkspaceId,
} from "@polaris/protocol";
import { Option, Predicate, Schema } from "effect";

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
  readonly capabilities: ReadonlyArray<Capability>;
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

/** The Host's Daemon has the `plan` PermissionMode (ENG-466). */
export const hasPlanMode = (host: SheetHost): boolean =>
  host.capabilities.includes("session.plan-mode");

export interface PermissionOption {
  readonly mode: PermissionMode;
  readonly label: string;
  readonly detail: string;
}

const WORDS: Readonly<Record<PermissionMode, Omit<PermissionOption, "mode">>> = {
  plan: { label: "Plan", detail: "Reads and plans, asks before any edit" },
  supervised: { label: "Supervised", detail: "Asks before edits and commands" },
  "auto-edits": { label: "Auto edits", detail: "Edits freely, asks before commands" },
  auto: { label: "Auto", detail: "Asks only for risky actions" },
  "full-access": { label: "Full access", detail: "Never asks" },
};

export const permissionOption = (mode: PermissionMode): PermissionOption => ({
  mode,
  ...WORDS[mode],
});

/** The Desktop App's start flow, in its order and words (`features/session/model/intent.ts`). */
export const PERMISSION_MODES: ReadonlyArray<PermissionOption> = (
  ["plan", "supervised", "auto-edits", "auto", "full-access"] as const
).map(permissionOption);

/** The modes the Host offers: Plan needs `session.plan-mode`. */
export const permissionModesOn = (host: SheetHost): ReadonlyArray<PermissionOption> =>
  hasPlanMode(host) ? PERMISSION_MODES : PERMISSION_MODES.filter((p) => p.mode !== "plan");

/**
 * The mode the sheet shows for the Host: the last one started there, else Plan; a Host without
 * plan mode gets Supervised instead.
 */
export const permissionModeOn = (
  host: SheetHost,
  remembered: PermissionMode | undefined
): PermissionMode => permissionModeFor(remembered ?? "plan", host.capabilities);

/** The mode each Host last started a session in, by Host id. */
export type PermissionModes = Readonly<Record<string, PermissionMode>>;

const decodeModes = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, PermissionMode))
);

/** The saved modes; nothing for text that isn't them (a mode a newer build wrote). */
export const parsePermissionModes = (text: string | null): PermissionModes =>
  text === null ? {} : Option.getOrElse(decodeModes(text), () => ({}));

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
  readonly permissionMode: PermissionMode;
  /** The Host's capabilities: `plan` falls back to `supervised` without `session.plan-mode`. */
  readonly capabilities: ReadonlyArray<Capability>;
  /** Staged on the Host before Start, in the order attached. */
  readonly attachments?: ReadonlyArray<AttachmentId>;
}

/** The StartSession command Start sends. */
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
    permissionMode: permissionModeFor(choices.permissionMode, choices.capabilities),
    model: choices.model === null ? null : ModelId.make(choices.model),
    effort: null,
    prompt: choices.prompt.trim(),
    attachments: [...(choices.attachments ?? [])],
  });

/** A caught failure's words for one caption line. */
export const failureText = (failure: NonNullable<unknown> | null | undefined): string => {
  if (failure instanceof Error) return failure.message;

  return Predicate.isString(failure) ? failure : "something went wrong";
};
