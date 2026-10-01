/**
 * The neutral notices above the pull request list (DESIGN.md Review → Pull requests): an
 * owner none of the accounts can see, an organization that hides a repository from every
 * account (OAuth App restrictions or SSO), and a failed poll. Never a signal colour.
 */
import type { PullListView, RepoAccessView, WorkspaceRef } from "../../../../shared/github.ts";
import { plural } from "../../../shell/copy.ts";

export type Notice =
  | {
      readonly kind: "no-account";
      readonly key: string;
      readonly owner: string;
      readonly title: string;
      readonly caption: string;
    }
  | {
      readonly kind: "blocked";
      readonly key: string;
      readonly repo: string;
      readonly title: string;
      readonly caption: string;
      readonly approvalUrl: string | null;
      readonly ssoUrl: string | null;
    }
  | {
      readonly kind: "error";
      readonly key: string;
      readonly title: string;
      readonly caption: string;
    };

export interface NoticesInput {
  readonly list: PullListView;
  /** Workspace → its Host's label, for "2 workspaces on Mac Studio". */
  readonly hostLabelOf: (ref: WorkspaceRef) => string | null;
  /** Keys the user answered "Not now". */
  readonly dismissed: ReadonlySet<string>;
}

const ownerOf = (repo: string) => repo.split("/")[0] ?? repo;

/** "2 workspaces on Mac Studio", "3 workspaces on 2 hosts". */
const pointing = (
  workspaces: ReadonlyArray<WorkspaceRef>,
  hostLabelOf: NoticesInput["hostLabelOf"]
) => {
  const hosts = [...new Set(workspaces.flatMap((w) => hostLabelOf(w) ?? []))];
  const where = hosts.length === 1 ? hosts[0] : plural(hosts.length, "host");
  const subject = workspaces.length === 1 ? "1 workspace" : `${workspaces.length} workspaces`;
  const verb = workspaces.length === 1 ? "points" : "point";

  return hosts.length === 0 ? `${subject} ${verb} at it` : `${subject} on ${where} ${verb} at it`;
};

const noAccount = (
  repos: ReadonlyArray<RepoAccessView>,
  input: NoticesInput
): ReadonlyArray<Notice> => {
  const byOwner = new Map<string, Array<WorkspaceRef>>();

  for (const repo of repos) {
    // `no-account` means nobody is signed in: the page's empty state says so instead.
    if (repo.state !== "not-found") continue;
    const owner = ownerOf(repo.repo);

    byOwner.set(owner, [...(byOwner.get(owner) ?? []), ...repo.workspaces]);
  }

  return [...byOwner].map(([owner, workspaces]) => ({
    kind: "no-account",
    key: `no-account:${owner.toLowerCase()}`,
    owner,
    title: `No GitHub account for ${owner}`,
    caption: `${pointing(workspaces, input.hostLabelOf)}, so its pull requests aren’t listed`,
  }));
};

const blocked = (repo: RepoAccessView, input: NoticesInput): Notice => ({
  kind: "blocked",
  key: `blocked:${repo.repo.toLowerCase()}`,
  repo: repo.repo,
  title: `${ownerOf(repo.repo)} hasn’t approved Polaris`,
  caption: `${repo.repo} is hidden from your accounts until the organization approves Polaris${
    repo.ssoUrl === null ? "" : " or you sign in with SSO"
  }. ${pointing(repo.workspaces, input.hostLabelOf)}.`,
  approvalUrl: repo.approvalUrl,
  ssoUrl: repo.ssoUrl,
});

export const noticesOf = (input: NoticesInput): ReadonlyArray<Notice> => {
  const error: ReadonlyArray<Notice> =
    input.list.error === null
      ? []
      : [
          {
            kind: "error",
            key: "error",
            title: "Couldn’t reach GitHub",
            caption: input.list.error,
          },
        ];

  const notices = [
    ...error,
    ...input.list.repos.filter((r) => r.state === "blocked").map((r) => blocked(r, input)),
    ...noAccount(input.list.repos, input),
  ];

  return notices.filter((n) => !input.dismissed.has(n.key));
};
