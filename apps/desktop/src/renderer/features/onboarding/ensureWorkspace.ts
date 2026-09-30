/**
 * The home-directory fallback: a new session with no Workspace on the Host
 * registers the Host's home directory as the Workspace "home" (or shows it
 * again if it was hidden), then waits for it to arrive in the Host's feed.
 */
import type { WorkspaceId } from "@polaris/protocol";
import type { PolarisApi } from "../../../shared/api.ts";
import { Commands, newCommandId } from "../../commands.ts";
import { shownWorkspaces } from "../../routes/topBar.ts";
import type { AppState, AppStore } from "../../store/store.ts";
import { workspaceAt } from "./model.ts";

export const HOME_WORKSPACE = "home";

export type Ensured =
  | { readonly ok: true; readonly workspaceId: WorkspaceId }
  | { readonly ok: false; readonly reason: string };

export type EnsureWorkspace = (hostKey: string) => Promise<Ensured>;

export interface EnsureInput {
  readonly api: Pick<PolarisApi, "request">;
  readonly store: Pick<AppStore, "getState" | "subscribe">;
  /** How long to wait for the Workspace to reach the feed. */
  readonly timeoutMs?: number;
}

const failed = (reason: string): Ensured => ({ ok: false, reason });

/** Resolves with the first state `pick` finds something in, or null after `ms`. */
const waitFor = <A>(
  store: EnsureInput["store"],
  pick: (state: AppState) => A | undefined,
  ms: number
): Promise<A | null> =>
  new Promise((resolve) => {
    const now = pick(store.getState());

    if (now !== undefined) {
      resolve(now);

      return;
    }

    const stop = () => {
      clearTimeout(timer);
      unsubscribe();
    };

    const timer = setTimeout(() => {
      stop();
      resolve(null);
    }, ms);

    const unsubscribe = store.subscribe((state) => {
      const found = pick(state);

      if (found === undefined) return;
      stop();
      resolve(found);
    });
  });

export type ShowFolder = (hostKey: string, path: string, name: string | null) => Promise<Ensured>;

/**
 * The Workspace at `path` on the Host, shown: registered (as `name`) if new, shown again if
 * hidden; resolves once the Host's feed has it.
 */
export const createShowFolder = ({ api, store, timeoutMs = 10_000 }: EnsureInput): ShowFolder => {
  const shownAt = (hostKey: string, path: string) => (state: AppState) => {
    const workspace = workspaceAt(state.hostModels[hostKey], path);

    return workspace !== undefined && !workspace.hidden ? workspace.id : undefined;
  };

  return async (hostKey, path, name) => {
    const state = store.getState();
    const host = state.hosts.find((h) => h.key === hostKey);
    const label = host?.label ?? hostKey;

    if (host?.status.state !== "connected") return failed(`${label} isn't connected`);

    const existing = workspaceAt(state.hostModels[hostKey], path);

    if (existing?.hidden === false) return { ok: true, workspaceId: existing.id };

    const command =
      existing === undefined
        ? Commands.RegisterWorkspace({ path, name })
        : Commands.SetWorkspaceHidden({ workspaceId: existing.id, hidden: false });

    const sent = await api.request("dispatch", { hostKey, commandId: newCommandId(), command });

    if (!sent.ok) return failed(sent.error.message);

    const workspaceId = await waitFor(store, shownAt(hostKey, path), timeoutMs);

    return workspaceId === null
      ? failed(`${label} didn't confirm the workspace`)
      : { ok: true, workspaceId };
  };
};

export const createEnsureWorkspace = (input: EnsureInput): EnsureWorkspace => {
  const { store } = input;
  const show = createShowFolder(input);
  const pending = new Map<string, Promise<Ensured>>();

  const ensure = async (hostKey: string): Promise<Ensured> => {
    const state = store.getState();
    const host = state.hosts.find((h) => h.key === hostKey);
    const model = state.hostModels[hostKey];
    const first = model === undefined ? undefined : shownWorkspaces(model)[0];

    if (first !== undefined) return { ok: true, workspaceId: first.id };

    const home = host?.status.host?.homeDir ?? null;

    if (host === undefined || home === null)
      return failed(`${host?.label ?? hostKey} isn't connected`);

    return show(hostKey, home, HOME_WORKSPACE);
  };

  return (hostKey) => {
    const running = pending.get(hostKey);

    if (running !== undefined) return running;

    const started = ensure(hostKey).finally(() => pending.delete(hostKey));

    pending.set(hostKey, started);

    return started;
  };
};
