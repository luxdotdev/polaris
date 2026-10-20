/** Opening a folder from the dialog: it becomes a Workspace on its Host, which is then selected. */
import { PixelAlertIcon, showToast } from "@polaris/ui";
import { createElement, useMemo, useState } from "react";
import type { HostView } from "../../../shared/api.ts";
import { barHosts } from "../../routes/topBar.ts";
import { useApp, useConnection, useNav, useShellActions } from "../../shell/hooks.ts";
import { createShowFolder } from "../onboarding/ensureWorkspace.ts";
import { rememberFolder } from "./recent.ts";

/** Every Host in the top bar's order (remote ones first, this Mac last), so ⌃N match. */
export const useDialogHosts = (): ReadonlyArray<HostView> => {
  const hosts = useApp((s) => s.hosts);

  return useMemo(() => barHosts({ hosts, models: {} }).map((h) => h.host), [hosts]);
};

export const useOpenFolder = (host: HostView) => {
  const { store } = useConnection();
  const { selectWorkspace, startNewSessionIn, closeFolder } = useShellActions();
  // From the new-session page's "Open folder…", the session moves there; else it is selected.
  const starting = useNav((s) => s.pane === "new-session");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = async (at: string) => {
    setBusy(true);
    setError(null);
    const shown = await createShowFolder({ api: window.polaris, store })(host.key, at, null);

    setBusy(false);

    if (!shown.ok) return setError(shown.reason);

    rememberFolder(host.key, at);
    closeFolder();

    if (starting) startNewSessionIn(host.key, shown.workspaceId);
    else selectWorkspace({ hostKey: host.key, workspaceId: shown.workspaceId });
  };

  /** Makes the folder on the Host (its parent is the folder listed), a repository where it can, then opens it. */
  const create = async (at: string) => {
    setBusy(true);
    setError(null);

    const made = await window.polaris.request("files.create", {
      hostKey: host.key,
      path: at,
      kind: "directory",
    });

    const repo =
      made.ok && host.status.capabilities.includes("git.init")
        ? await window.polaris.request("git.init", { hostKey: host.key, path: at })
        : null;

    setBusy(false);

    if (!made.ok) return setError(made.error.message);

    if (repo !== null && !repo.ok)
      return setError(`git init failed in ${at}: ${repo.error.message}`);

    if (repo?.value.head === null)
      showToast({
        source: "starlight",
        icon: createElement(PixelAlertIcon, { size: 16 }),
        title: "No first commit yet",
        message: `${repo.value.note ?? "git refused it"}. New worktrees need one.`,
      });

    await path(at);
  };

  const finder = async () => {
    const picked = await window.polaris.request("dialog.pickFolder", {});

    if (picked.ok && picked.value.path !== null) await path(picked.value.path);
  };

  return { open: { path, create, finder }, busy, error };
};
