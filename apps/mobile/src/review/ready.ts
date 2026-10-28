/**
 * The Review tab (Paper H4) as data: every Host's agent sessions ready to review, newest first,
 * and why the list is empty. Pure, so every state is testable.
 */
import type { Session } from "../home/feed/fold.ts";
import type { HomeHost, SessionRow } from "../home/model/home.ts";

export type ReadyEmpty =
  /** No Host is known yet: link this iPhone. */
  | "no-hosts"
  /** Hosts are known but none has been reached this launch. */
  | "unreachable"
  /** Reached, and nothing waits for review. */
  | "none";

export interface ReadyToReview {
  readonly rows: ReadonlyArray<SessionRow>;
  readonly empty: ReadyEmpty | null;
}

/** Its last Turn ended and nothing waits on the user, with a Turn after the accepted one. */
export const isReadyToReview = (session: Session): boolean =>
  session.state === "idle" &&
  session.origin == null &&
  session.turnCount > 0 &&
  (session.acceptedThroughIndex ?? -1) < session.turnCount - 1;

const rowsOf = (host: HomeHost): ReadonlyArray<SessionRow> =>
  [...host.followed.state.sessions.values()].flatMap((entry) =>
    isReadyToReview(entry.session) && entry.pendingApprovals.length === 0
      ? [
          {
            kind: "session" as const,
            key: `${host.hostId}/${entry.session.id}`,
            hostId: host.hostId,
            hostName: host.name,
            workspaceName:
              host.followed.state.workspaces.get(entry.session.workspaceId)?.name ?? "",
            session: entry.session,
            approval: null,
            replyPreview: entry.replyPreview,
            since: Date.parse(entry.session.updatedAt),
            stale: host.connection !== "connected",
          },
        ]
      : []
  );

export const readyToReview = (hosts: ReadonlyArray<HomeHost>): ReadyToReview => {
  const rows = hosts.flatMap(rowsOf).sort((a, b) => b.since - a.since);

  if (hosts.length === 0) return { rows, empty: "no-hosts" };

  if (rows.length > 0) return { rows, empty: null };

  return { rows, empty: hosts.some((host) => host.followed.seen) ? "none" : "unreachable" };
};
