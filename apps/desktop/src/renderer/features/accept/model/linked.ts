/**
 * Agent Sessions linked to a pull request (ENG-224): the session stays Idle until its pull
 * request merges or closes, then archives itself. These pick out the sessions to watch and
 * the ones to archive from the GitHub client's states. Pure.
 */
import type { CheckoutStateView, PullRef } from "../../../../shared/github.ts";
import type { HostModel } from "../../../store/hostModel.ts";

export interface LinkedSession {
  /** `session:<hostKey>:<sessionId>`: the watch key. */
  readonly key: string;
  readonly hostKey: string;
  readonly sessionId: string;
  readonly pull: PullRef;
}

export const linkedKey = (hostKey: string, sessionId: string) => `session:${hostKey}:${sessionId}`;

/** Every session with a pull request that isn't archived yet, on every Host. */
export const linkedSessions = (
  hostModels: Readonly<Record<string, HostModel>>
): ReadonlyArray<LinkedSession> =>
  Object.entries(hostModels).flatMap(([hostKey, model]) =>
    [...model.sessions.values()].flatMap(({ session }) =>
      session.pullRequest === null || session.state === "archived"
        ? []
        : [
            {
              key: linkedKey(hostKey, session.id),
              hostKey,
              sessionId: session.id,
              pull: {
                repo: {
                  owner: session.pullRequest.repo.owner,
                  name: session.pullRequest.repo.name,
                },
                number: session.pullRequest.number,
              },
            },
          ]
    )
  );

/** The linked sessions whose pull request merged or closed and that weren't archived yet. */
export const toArchive = (
  states: ReadonlyArray<CheckoutStateView>,
  linked: ReadonlyArray<LinkedSession>,
  asked: ReadonlySet<string>
): ReadonlyArray<LinkedSession> => {
  const ended = new Set(
    states.flatMap((s) => (s.state === "merged" || s.state === "closed" ? [s.key] : []))
  );

  return linked.filter((l) => ended.has(l.key) && !asked.has(l.key));
};

/** The pull request's page on GitHub. */
export const pullUrl = (pull: PullRef) =>
  `https://github.com/${pull.repo.owner}/${pull.repo.name}/pull/${pull.number}`;
