/**
 * The adaptive top bar (ENG-177): every Workspace on every Host as a chip
 * while there are at most 10, the machine bar from 11, and nothing at all in
 * machine mode with a single Host. Pure, so it is unit-tested.
 */
import type { AgentSession, SessionState, Workspace, WorkspaceId } from "@polaris/protocol";
import type { HostView } from "../../shared/api.ts";
import type { HostModel, SessionEntry } from "../store/hostModel.ts";

export type TopBarMode = "workspaces" | "machines" | "hidden";

/** The machine bar takes over at this many Workspaces… */
export const MACHINE_BAR_AT = 11;

/** …and gives way again only at this many, so the bar never flips at 10/11. */
export const WORKSPACE_BAR_AT = 9;

export interface TopBarInput {
  readonly workspaces: number;
  readonly hosts: number;
  /** The bar's mode before this change; decides the band between the thresholds. */
  readonly previous: TopBarMode;
}

export const topBarMode = ({ workspaces, hosts, previous }: TopBarInput): TopBarMode => {
  const machines =
    workspaces >= MACHINE_BAR_AT || (previous !== "workspaces" && workspaces > WORKSPACE_BAR_AT);

  if (!machines) return "workspaces";

  return hosts <= 1 ? "hidden" : "machines";
};

/** Session States in the order a Workspace chip shows them: the loudest wins. */
const STATE_PRIORITY: ReadonlyArray<SessionState> = [
  "needs-you",
  "failed",
  "working",
  "starting",
  "in-terminal",
  "idle",
  "dormant",
];

export interface Summary {
  /** The state a chip or machine tab shows; null when nothing is active there. */
  readonly state: SessionState | null;
  /** The Harness of the session that decided `state` (for the dither's hue). */
  readonly harness: AgentSession["harness"] | null;
  readonly needsYou: number;
  readonly sessions: number;
}

export const needsYou = (entry: SessionEntry) =>
  entry.session.state === "needs-you" || entry.pendingApprovals.length > 0;

/** Sessions that count as active: everything but Archived. */
export const activeSessions = (model: HostModel, workspaceId?: WorkspaceId) =>
  [...model.sessions.values()].filter(
    (e) =>
      e.session.state !== "archived" &&
      (workspaceId === undefined || e.session.workspaceId === workspaceId)
  );

/** A session's state as the chrome shows it: a pending approval counts as Needs You. */
export const shownState = (entry: SessionEntry): SessionState =>
  needsYou(entry) ? "needs-you" : entry.session.state;

export const summarize = (entries: ReadonlyArray<SessionEntry>): Summary => {
  let best: SessionEntry | null = null;
  const rank = (entry: SessionEntry) => STATE_PRIORITY.indexOf(shownState(entry));

  for (const entry of entries) {
    if (best === null || rank(entry) < rank(best)) best = entry;
  }

  return {
    state: best === null ? null : shownState(best),
    harness: best?.session.harness ?? null,
    needsYou: entries.filter(needsYou).length,
    sessions: entries.length,
  };
};

/** Workspaces the bar and sidebar list: not hidden (CONTEXT.md: hidden when idle), oldest first. */
export const shownWorkspaces = (model: HostModel): ReadonlyArray<Workspace> =>
  [...model.workspaces.values()]
    .filter((w) => !w.hidden)
    .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.name.localeCompare(b.name));

export interface BarWorkspace {
  readonly hostKey: string;
  readonly workspace: Workspace;
  readonly summary: Summary;
}

export interface BarHost {
  readonly host: HostView;
  readonly workspaces: ReadonlyArray<BarWorkspace>;
  readonly summary: Summary;
}

export interface BarInput {
  readonly hosts: ReadonlyArray<HostView>;
  readonly models: Readonly<Record<string, HostModel>>;
}

/** The local Host's key (main/hosts.ts `LOCAL_HOST_KEY`). */
export const LOCAL_HOST = "local";

/** Remote Hosts first in settings order, this Mac last (Paper 11U-0, MX-0), so ⌃N match. */
const barOrder = (hosts: ReadonlyArray<HostView>) => [
  ...hosts.filter((h) => h.key !== LOCAL_HOST),
  ...hosts.filter((h) => h.key === LOCAL_HOST),
];

/** Every Host with its shown Workspaces; the source of both bars. */
export const barHosts = ({ hosts, models }: BarInput): ReadonlyArray<BarHost> =>
  barOrder(hosts).map((host) => {
    const model = models[host.key];
    const workspaces = model === undefined ? [] : shownWorkspaces(model);

    return {
      host,
      workspaces: workspaces.map((workspace) => ({
        hostKey: host.key,
        workspace,
        summary: summarize(model === undefined ? [] : activeSessions(model, workspace.id)),
      })),
      summary: summarize(model === undefined ? [] : activeSessions(model)),
    };
  });

/** The Workspace chips in bar order: ⌃1 is the first, ⌃0 the tenth. */
export const barWorkspaces = (hosts: ReadonlyArray<BarHost>): ReadonlyArray<BarWorkspace> =>
  hosts.flatMap((h) => h.workspaces);

/** "⌃1" … "⌃9", "⌃0" for the tenth; nothing past it. */
export const shortcutLabel = (index: number): string | undefined =>
  index < 9 ? `⌃${index + 1}` : index === 9 ? "⌃0" : undefined;
