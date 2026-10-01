/**
 * A Harness's Skills and Slash Commands in a directory, from the Host
 * (`harness.commands`). Asked when the composer is first focused, not before,
 * and kept per Host, Harness and directory; the Daemon caches them too.
 */
import type { HarnessKind } from "@polaris/protocol";
import { useEffect, useState } from "react";
import { polaris } from "../bridge.ts";
import type { CommandOption } from "./model/commands.ts";

interface Listing {
  readonly options: ReadonlyArray<CommandOption>;
  readonly loading: boolean;
}

const NONE: Listing = { options: [], loading: false };

const known = new Map<string, ReadonlyArray<CommandOption>>();

/** Asks the Host; a failure keeps what was known (the menu just offers less). */
const ask = (hostKey: string, harness: HarnessKind, cwd: string) =>
  polaris()
    .request("harness.commands", { hostKey, harness, cwd, refresh: false })
    .then((result) => {
      const key = `${hostKey}\u0000${harness}\u0000${cwd}`;

      if (result.ok) known.set(key, result.value.commands);

      return known.get(key) ?? [];
    });

/**
 * The session's commands once `wanted` (the composer was focused). Unset
 * `cwd` or a Host without the capability lists none.
 */
export const useHarnessCommands = (
  hostKey: string,
  harness: HarnessKind | null,
  cwd: string | null,
  enabled: boolean
): Listing & { readonly want: () => void } => {
  const key = harness === null || cwd === null ? null : `${hostKey}\u0000${harness}\u0000${cwd}`;
  // Once focused, whatever the Harness and directory become (the new-session page picks later).
  const [wanted, setWanted] = useState(false);

  const [state, setState] = useState<{ readonly key: string; readonly listing: Listing } | null>(
    null
  );

  useEffect(() => {
    if (!enabled || key === null || !wanted || harness === null || cwd === null) return undefined;
    let current = true;

    void ask(hostKey, harness, cwd).then((options) => {
      if (current) setState({ key, listing: { options, loading: false } });
    });

    return () => {
      current = false;
    };
  }, [enabled, hostKey, harness, cwd, key, wanted]);

  const cached = key === null ? undefined : known.get(key);
  const fetched = state?.key === key ? state?.listing : undefined;

  const listing =
    fetched ??
    (cached === undefined
      ? { options: [], loading: enabled && wanted }
      : { options: cached, loading: false });

  return { ...(enabled ? listing : NONE), want: () => setWanted(true) };
};
