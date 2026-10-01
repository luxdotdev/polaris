/**
 * The verbs for one session's Working strip. Claude Code sessions ask their Host
 * for `spinnerVerbs` when a Turn starts (the Daemon re-reads a settings file only
 * if it changed), so an edit shows from the next Turn and nothing runs at idle.
 */
import type { SpinnerVerbs } from "@polaris/protocol";
import { useEffect, useMemo, useState } from "react";
import type { Plain } from "../../../../shared/api.ts";
import { useSettings } from "../../settings/index.ts";
import { hasCapability, useHost } from "../hooks.ts";
import { resolveVerbs } from "./model.ts";

export interface VerbsInput {
  readonly hostKey: string;
  readonly harness: string;
  readonly cwd: string;
  /** The Turn in flight; null while none runs. A new one asks again. */
  readonly turnId: string | null;
}

export const useWorkingVerbs = ({ hostKey, harness, cwd, turnId }: VerbsInput) => {
  const app = useSettings((s) => s.sessions.spinnerVerbs);
  const host = useHost(hostKey);
  const asks = harness === "claude" && hasCapability(host, "harness.spinner-verbs");
  // Claude Code's setting as last asked; undefined until the first answer.
  const [asked, setAsked] = useState<Plain<SpinnerVerbs> | null | undefined>(undefined);

  useEffect(() => {
    if (!asks || turnId === null) return undefined;

    let live = true;

    void window.polaris.request("harness.spinnerVerbs", { hostKey, cwd }).then((result) => {
      // A Host that can't say keeps the last answer, or the app's verbs.
      if (live && result.ok) setAsked(result.value);
    });

    return () => {
      live = false;
    };
  }, [asks, hostKey, cwd, turnId]);

  const claude = asks ? (asked ?? null) : null;

  return useMemo(() => resolveVerbs({ app, claude }), [app, claude]);
};
