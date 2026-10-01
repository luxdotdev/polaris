/**
 * Every Agent Session as Review's queue and the pull request list's "Agent sessions ready"
 * group need it, across every Host; a Reviewer's own read-only sessions are left out.
 */
import type { AppState } from "../../../store/store.ts";
import type { SessionInfo } from "./queue.ts";

/**
 * A Reviewer's or walkthrough's own read-only session has nothing to review: it runs inside a
 * Review Checkout (`.review/pr-N`), or is titled "Reviewer · …" / "Walkthrough · …" in place.
 */
const isReviewer = (cwd: string, title: string) =>
  /[/\\]\.review[/\\]/.test(cwd) ||
  title.startsWith("Reviewer · ") ||
  title.startsWith("Walkthrough · ");

export const sessionsOf = (models: AppState["hostModels"]): ReadonlyArray<SessionInfo> =>
  Object.entries(models).flatMap(([hostKey, model]) =>
    [...model.sessions.values()].flatMap(({ session }) =>
      isReviewer(session.cwd, session.title)
        ? []
        : [
            {
              hostKey,
              id: session.id,
              title: session.title,
              harness: session.harness,
              state: session.state,
              turnCount: session.turnCount,
              acceptedThroughIndex: session.acceptedThroughIndex ?? null,
              updatedAt: session.updatedAt,
              workspaceName: model.workspaces.get(session.workspaceId)?.name ?? null,
            },
          ]
    )
  );
