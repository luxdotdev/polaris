/**
 * Each connected Host's Reviewer settings (`review.reviewerSettings`), and writing them
 * back. A change shows at once, then the Host is asked again for what it now resolves.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { useApp } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import type { HostReviewer, Settings } from "../model/reviewer.ts";

const CAPABILITY = "review.reviewer-settings";

const LOADING: HostReviewer = { kind: "loading" };

const staticState = (host: HostView): HostReviewer | null => {
  if (host.status.state !== "connected")
    return { kind: "unavailable", reason: "Host not connected" };

  return host.status.capabilities.includes(CAPABILITY)
    ? null
    : { kind: "unavailable", reason: "This host's daemon can't run a reviewer" };
};

const load = async (hostKey: string): Promise<HostReviewer> => {
  const result = await polaris().request("review.reviewerSettings", { hostKey, workspaceId: null });

  return result.ok
    ? { kind: "loaded", settings: result.value.settings, resolved: result.value.resolved }
    : { kind: "unavailable", reason: "Couldn't read this host's reviewer" };
};

export const useReviewers = () => {
  const hosts = useApp((s) => s.hosts);
  const [loaded, setLoaded] = useState<Readonly<Record<string, HostReviewer>>>({});
  const capable = hosts.filter((h) => staticState(h) === null).map((h) => h.key);
  const capableKey = capable.join("\u0000");

  const refresh = useCallback((hostKey: string) => {
    void load(hostKey).then((state) => setLoaded((s) => ({ ...s, [hostKey]: state })));
  }, []);

  useEffect(() => {
    for (const key of capableKey === "" ? [] : capableKey.split("\u0000")) refresh(key);
  }, [capableKey, refresh]);

  const reviewers = useMemo(
    (): Readonly<Record<string, HostReviewer>> =>
      Object.fromEntries(
        hosts.map((h): readonly [string, HostReviewer] => [
          h.key,
          staticState(h) ?? loaded[h.key] ?? LOADING,
        ])
      ),
    [hosts, loaded]
  );

  const save = useCallback(
    (hostKey: string, settings: Settings) => {
      setLoaded((s) => {
        const current = s[hostKey];

        return current?.kind === "loaded" ? { ...s, [hostKey]: { ...current, settings } } : s;
      });
      void polaris()
        .request("review.setReviewerSettings", { hostKey, settings })
        .then(() => refresh(hostKey));
    },
    [refresh]
  );

  return { reviewers, save };
};
