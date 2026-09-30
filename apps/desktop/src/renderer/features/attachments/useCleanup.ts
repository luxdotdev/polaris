/**
 * One Host's attachment cleanup for Settings: loads its settings and usage,
 * saves changes (shown at once, reloaded if the Host refuses), and clears.
 */
import type { WorkspaceId } from "@polaris/protocol";
import { useCallback, useEffect, useState } from "react";
import type { RequestOutput } from "../../../shared/api.ts";
import { polaris } from "../bridge.ts";
import { showRefusal } from "../session/dispatch.ts";
import type { CleanupSettings } from "./cleanup.ts";

type Loaded = RequestOutput<"attachments.settings">;

export type CleanupState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly data: Loaded };

export const useCleanup = (hostKey: string, enabled: boolean) => {
  const [state, setState] = useState<CleanupState>({ kind: "loading" });

  const load = useCallback(async () => {
    const result = await polaris().request("attachments.settings", { hostKey });

    setState(
      result.ok
        ? { kind: "ready", data: result.value }
        : { kind: "failed", message: result.error.message }
    );
  }, [hostKey]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const save = async (settings: CleanupSettings) => {
    setState((s) => (s.kind === "ready" ? { kind: "ready", data: { ...s.data, settings } } : s));
    const result = await polaris().request("attachments.setSettings", { hostKey, settings });

    if (!result.ok) {
      showRefusal("Couldn't save attachment settings", result.error);
      await load();
    }
  };

  /** Clears one Workspace's staged files, or all of them (null); reloads the usage after. */
  const clear = async (workspaceId: WorkspaceId | null) => {
    const result = await polaris().request("attachments.clear", { hostKey, workspaceId });

    if (!result.ok) showRefusal("Couldn't clear attachments", result.error);
    await load();
  };

  return { state, save, clear };
};
