/**
 * The rail's Where block (Paper R1, R2): Host and Workspace, the branch with ahead and behind,
 * and the linked pull request; dimmed while the Host is out of reach.
 */
import { BranchIcon, cn, ServerIcon } from "@polaris/ui";
import type { SessionId } from "@polaris/protocol";
import { homePath } from "../../../../shell/copy.ts";
import { useApp } from "../../../../shell/hooks.ts";
import type { SessionModel } from "../../../../store/sessionModel.ts";
import { useOnSharedHost } from "../../../sharing/index.ts";
import { useHost } from "../../hooks.ts";
import { branchLine, type GitFacts } from "../gitStatus.ts";
import { aheadBehind } from "./model.ts";
import { PullRequestIcon, ROW, Section, Slot } from "./parts.tsx";

const basename = (path: string) => path.split(/[/\\]/).findLast((p) => p !== "") ?? path;

export const WhereBlock = ({
  hostKey,
  model,
  git,
}: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly model: SessionModel;
  readonly git: GitFacts;
}) => {
  const host = useHost(hostKey);
  const session = model.session;

  const workspace = useApp((s) =>
    session === null ? undefined : s.hostModels[hostKey]?.workspaces.get(session.workspaceId)
  );

  const branch = branchLine(git, useOnSharedHost(hostKey));

  if (session === null) return null;
  const sync = git.kind === "ready" ? aheadBehind(git.ahead, git.behind) : null;
  const pr = session.pullRequest ?? null;

  return (
    <Section label="Where" dimmed={host !== undefined && host.status.state !== "connected"}>
      <div
        className={cn(ROW, "h-tree-row")}
        title={homePath(session.cwd, host?.status.host?.homeDir ?? null)}
      >
        <Slot>
          <ServerIcon size={14} />
        </Slot>
        <span className="text-body text-text-default truncate" data-testid="rail-where">
          {host?.label ?? hostKey}
          <span className="text-text-faint"> · </span>
          {workspace?.name ?? basename(session.cwd)}
        </span>
      </div>
      {branch === null || branch === "" ? null : (
        <div className={cn(ROW, "h-tree-row")} title={branch}>
          <Slot>
            <BranchIcon size={14} />
          </Slot>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              git.kind === "ready"
                ? "text-code-inline text-text-default font-mono"
                : "text-caption text-text-subtle"
            )}
          >
            {branch}
          </span>
          {sync === null ? null : (
            <span className="text-text-subtle tabular shrink-0 font-mono text-[11px]">{sync}</span>
          )}
        </div>
      )}
      {pr === null ? null : (
        <div
          className={cn(ROW, "h-tree-row")}
          title={`${pr.repo.owner}/${pr.repo.name}#${pr.number}`}
        >
          <Slot>
            <PullRequestIcon />
          </Slot>
          <span className="text-body text-text-default tabular truncate">#{pr.number}</span>
        </div>
      )}
    </Section>
  );
};
