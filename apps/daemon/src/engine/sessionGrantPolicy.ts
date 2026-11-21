/** Session Grants and Starter accounting, decided against the committed model (ADR 0119). */
import {
  accessFor,
  type Command,
  type DomainEvent,
  type GrantKind,
  PermissionMode,
  type SessionId,
  type Starter,
  type SessionState,
} from "@polaris/protocol";
import { Predicate } from "effect";
import type { ReadModel, SessionRecord } from "../store/model.ts";

const SETTINGS_COMMANDS = new Set(["SetModel", "SetPermissionMode", "SetResumeAtReset"]);

const SETTINGS_RPCS = new Set([
  "settings.set",
  "sessions.setAutoArchive",
  "sessions.setIdleCompaction",
  "sessions.setSuggestedReplies",
  "sessions.setVisuals",
  "constellation.defaults.set",
  "review.setReviewerSettings",
  "attachments.setSettings",
  "traces.setSettings",
]);

const SETTING_GROUPS = [
  "reviewer",
  "constellation",
  "attachments",
  "visuals",
  "sessions.autoArchive",
  "sessions.idleCompaction",
  "sessions.suggestedReplies",
  "sessions.defaults",
  "traces",
];

const hostSettingGrant = (settingKey: string | undefined): GrantKind | "client" => {
  if (settingKey === undefined || settingKey === "sessions.defaults") return "client";

  if (settingKey.endsWith(".permissionMode")) return "client";

  return SETTING_GROUPS.some((key) => settingKey === key || settingKey.startsWith(`${key}.`))
    ? "settings"
    : "client";
};

export interface SessionAction {
  readonly rpc: string;
  readonly command?: Command;
  readonly settingKey?: string | undefined;
}

export const sessionActionGrant = ({
  rpc,
  command,
  settingKey,
}: SessionAction): GrantKind | "open" | "client" => {
  if (rpc === "settings.set") return hostSettingGrant(settingKey);

  if (rpc === "clientSettings.set") return "settings";

  if (rpc === "dispatch" && command !== undefined) {
    if (
      Predicate.isTagged(command, "StartSession") &&
      (command.origin != null ||
        command.reviewSubject != null ||
        Predicate.isTagged(command.placement, "ReviewCheckout"))
    )
      return "client";

    if (SETTINGS_COMMANDS.has(command._tag)) return "settings";

    if (Predicate.isTagged(command, "StopBackgroundTasks")) return "turn";
  }

  if (SETTINGS_RPCS.has(rpc)) return "settings";

  return accessFor(rpc, command?._tag ?? null).access;
};

export const starterChain = (model: ReadModel, sessionId: SessionId): ReadonlySet<SessionId> => {
  const chain = new Set<SessionId>();
  let next: SessionId | undefined = sessionId;

  while (next !== undefined && !chain.has(next)) {
    chain.add(next);
    const starter: Starter | undefined = model.sessions.get(next)?.session.starter;
    next = Predicate.isTagged(starter, "AgentSession") ? starter.sessionId : undefined;
  }

  return chain;
};

export const inStarterChain = (model: ReadModel, caller: SessionId, target: SessionId) =>
  starterChain(model, target).has(caller) || starterChain(model, caller).has(target);

const modeRank = (mode: PermissionMode) => PermissionMode.literals.indexOf(mode);

const targetOf = ({ command }: SessionAction) =>
  command !== undefined && "sessionId" in command ? command.sessionId : null;

/** Refusals no Grant Approval can lift: a session never raises a permission mode past its own. */
export const sessionActionRefusal = (
  model: ReadModel,
  caller: SessionId,
  input: SessionAction
): string | null => {
  const { command } = input;
  const own = model.sessions.get(caller)?.session.permissionMode;

  if (input.rpc !== "dispatch" || command === undefined || own === undefined) return null;

  const mode =
    Predicate.isTagged(command, "StartSession") || Predicate.isTagged(command, "SetPermissionMode")
      ? command.permissionMode
      : null;

  if (mode !== null && modeRank(mode) > modeRank(own))
    return `This session runs in ${own}; only the user can give a session ${mode}.`;

  const target = targetOf(input);

  if (
    SETTINGS_COMMANDS.has(command._tag) &&
    target !== null &&
    target !== caller &&
    !inStarterChain(model, caller, target)
  )
    return "A session can change only itself and the sessions in its Starter chain.";

  return null;
};

export const sessionActionAllowed = (model: ReadModel, caller: SessionId, input: SessionAction) => {
  if (sessionActionRefusal(model, caller, input) !== null) return false;
  const needed = sessionActionGrant(input);

  if (needed === "open") return true;

  if (needed === "client" || needed === "approve" || needed === "voice") return false;
  const record = model.sessions.get(caller);

  if (record === undefined) return false;

  const target = targetOf(input);

  if (needed === "turn" && (target === null || !inStarterChain(model, caller, target)))
    return false;

  // A remembered Grant covers starts in the caller's own Workspace; another Workspace asks.
  if (
    Predicate.isTagged(input.command, "StartSession") &&
    input.command.workspaceId !== record.session.workspaceId
  )
    return false;
  const workspace = model.workspaces.get(record.session.workspaceId);

  return record.session.grant.includes(needed) || workspace?.sessionGrant.includes(needed) === true;
};

export const countsAsRunning = (state: SessionState) => state === "starting" || state === "working";

export const startBudgetRefusal = (
  model: ReadModel,
  starter: SessionId,
  waking?: SessionId
): string | null => {
  for (const id of starterChain(model, starter)) {
    const limit = model.sessions.get(id)?.session.startLimit ?? model.sessionStartLimit ?? 5;
    const count = runningStartedBy(model, id, waking);

    if (count >= limit)
      return `Session ${id} has reached its start budget of ${limit} running sessions. Stop a session or ask the user to raise the limit.`;
  }

  return null;
};

/** A wake-up spends a slot too; a pending Approval never reserves one. */
export const wakingBudgetRefusal = (
  model: ReadModel,
  record: SessionRecord | undefined,
  events: ReadonlyArray<DomainEvent>
) => {
  if (
    record === undefined ||
    countsAsRunning(record.session.state) ||
    record.session.worker != null ||
    !Predicate.isTagged(record.session.starter, "AgentSession")
  )
    return null;

  if (
    !events.some(
      (event) => Predicate.isTagged(event, "SessionStateChanged") && countsAsRunning(event.state)
    )
  )
    return null;

  return startBudgetRefusal(model, record.session.starter.sessionId, record.session.id);
};

export const runningStartedBy = (
  model: ReadModel,
  starter: SessionId,
  waking?: SessionId
): number => {
  let count = 0;

  for (const { session } of model.sessions.values()) {
    if (
      session.id !== waking &&
      session.id !== starter &&
      session.worker == null &&
      countsAsRunning(session.state) &&
      starterChain(model, session.id).has(starter)
    )
      count++;
  }

  return count;
};

export const startLimitRefusal = (
  model: ReadModel,
  sessionId: SessionId | null,
  limit: number
): string | null => {
  const ids =
    sessionId === null
      ? [...model.sessions.keys()].filter(
          (id) => model.sessions.get(id)?.session.startLimit == null
        )
      : [sessionId];

  return ids.some((id) => runningStartedBy(model, id) > limit)
    ? "Stop sessions before lowering the start limit below the number already running."
    : null;
};
