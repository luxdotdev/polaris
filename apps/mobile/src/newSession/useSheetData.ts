/** A new session's Hosts and calls: Home's followed feeds over the app's HostConnections. */
import { useMemo } from "react";
import type { HostFeedState } from "../home/feed/fold.ts";
import { useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { useHosts } from "../runtime/hosts.tsx";
import type { NewSessionApi } from "./api.ts";
import { type HostFeed, newSessionApi, sheetHost } from "./connect.ts";
import type { SheetHost } from "./model.ts";

const feedOf = (state: HostFeedState): HostFeed => ({
  workspaces: [...state.workspaces.values()],
  sessions: [...state.sessions.values()].map((entry) => entry.session),
});

export interface SheetData {
  readonly hosts: ReadonlyArray<SheetHost>;
  readonly api: NewSessionApi;
}

export const useSheetData = (): SheetData => {
  const connections = useHosts();
  const followed = useFollowedHosts();
  const api = useMemo(() => newSessionApi(connections), [connections]);

  return {
    api,
    hosts: followed.map((f) =>
      sheetHost(f.connection, f.followed.seen ? feedOf(f.followed.state) : null)
    ),
  };
};
