/**
 * The accept flow's ports over the bridge: the Daemon's accept RPCs and commands on the
 * session's Host, and the GitHub client in the main process for the pull request.
 */
import {
  type AcceptBranch,
  PullRequestRef,
  RepoRef as ProtocolRepoRef,
  type SessionId,
  type TurnId,
} from "@polaris/protocol";
import type { IpcError } from "../../../../shared/api.ts";
import type { RepoRef } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import { polaris } from "../../bridge.ts";
import { dispatch } from "../../session/dispatch.ts";
import type { AcceptPorts, Answer } from "../model/flow.ts";

const sent = async (result: Promise<{ ok: true } | { ok: false; error: IpcError }>) => {
  const answer = await result;

  return answer.ok ? { ok: true as const, value: null } : answer;
};

/** GitHub.com is the only code host in M2 (ENG-228). */
export const protocolRepo = (repo: RepoRef) =>
  new ProtocolRepoRef({ host: "github.com", owner: repo.owner, name: repo.name });

export const acceptPorts = (hostKey: string): AcceptPorts => ({
  accept: (request) =>
    sent(
      dispatch(
        hostKey,
        Commands.AcceptTurns({
          sessionId: request.sessionId,
          throughTurnId: request.throughTurnId,
          revertLaterTurns: request.revertLaterTurns,
        })
      )
    ),
  commit: (request) =>
    polaris().request("session.commitAccepted", {
      hostKey,
      sessionId: request.sessionId,
      throughTurnId: request.throughTurnId,
      branch: request.branch,
      granularity: request.granularity,
      title: request.title,
      body: request.body,
      turnTitles: request.turnTitles,
    }),
  push: async (sessionId, branch) => {
    const result = await polaris().request("session.pushAccepted", { hostKey, sessionId, branch });

    return result.ok ? { ok: true, value: null } : result;
  },
  openPull: async (pull, head, base) => {
    const result = await polaris().request("github.pull.create", {
      repo: pull.repo,
      head,
      base,
      title: pull.title,
      body: pull.body,
      draft: pull.draft,
      workspace: pull.workspace,
    });

    return result.ok
      ? { ok: true, value: { number: result.value.number, url: result.value.url } }
      : result;
  },
  link: (sessionId, repo, pull) =>
    sent(
      dispatch(
        hostKey,
        Commands.LinkPullRequest({
          sessionId,
          pullRequest: new PullRequestRef({ repo: protocolRepo(repo), number: pull.number }),
        })
      )
    ),
});

export const fetchPlan = (hostKey: string, sessionId: SessionId, throughTurnId: TurnId) =>
  polaris().request("session.acceptPlan", { hostKey, sessionId, throughTurnId });

export const fetchDraft = (hostKey: string, sessionId: SessionId, throughTurnId: TurnId) =>
  polaris().request("session.draftAccept", { hostKey, sessionId, throughTurnId });

export type { AcceptBranch, Answer };
