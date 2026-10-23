/**
 * A `polaris://` link from the main process: open its session or Workspace. At launch its Host
 * may still be connecting, so the link waits for that Host's `hostId` to appear, then gives up.
 */
import type { DeepLink } from "../../shared/deepLink.ts";
import { type AppStore, hostKeyOf } from "../store/store.ts";
import type { ShellActions } from "./navigation.ts";

export const DEEP_LINK_WAIT_MS = 15_000;

let cancelPending: (() => void) | null = null;

const open = (
  link: DeepLink,
  hostKey: string,
  actions: Pick<ShellActions, "selectSession" | "selectWorkspace">
) => {
  if (link.target === "session") actions.selectSession({ hostKey, sessionId: link.sessionId });
  else actions.selectWorkspace({ hostKey, workspaceId: link.workspaceId });
};

/** A later link replaces one still waiting for its Host. */
export const onDeepLinkEvent = (
  link: DeepLink,
  app: AppStore,
  actions: Pick<ShellActions, "selectSession" | "selectWorkspace">,
  waitMs = DEEP_LINK_WAIT_MS
) => {
  cancelPending?.();
  cancelPending = null;
  const known = hostKeyOf(app.getState().hosts, link.hostId);

  if (known !== null) {
    open(link, known, actions);

    return;
  }

  const stop = () => {
    unsubscribe();
    clearTimeout(timer);
    cancelPending = null;
  };

  const unsubscribe = app.subscribe((state) => {
    const hostKey = hostKeyOf(state.hosts, link.hostId);

    if (hostKey === null) return;
    stop();
    open(link, hostKey, actions);
  });

  const timer = setTimeout(() => {
    stop();
    console.warn(`polaris: ignored a deep link to a Host that never connected: ${link.hostId}`);
  }, waitMs);

  cancelPending = stop;
};
