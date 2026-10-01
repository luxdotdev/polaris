/**
 * Stacks of pull requests (docs/research/github-stacks.md): GitHub's own, read with the
 * list and detail queries, else inferred from the open pull requests' branches. The rules
 * are DESIGN.md's (Review → Stacks). Pure, so it is tested.
 */
import {
  type ChecksView,
  pullStatus,
  type PullRowView,
  type StackMemberView,
  type StackView,
} from "../../shared/github.ts";
import type { ChecksData, GitHubStack, StackMember } from "./queries.ts";

const CHECK_STATES = new Map<string, ChecksView["state"]>([
  ["SUCCESS", "success"],
  ["FAILURE", "failure"],
  ["ERROR", "failure"],
]);

/** The head commit's rollup; null when it has no checks. */
export const checksOf = (commits: ChecksData | undefined): ChecksView | null => {
  const rollup = commits?.nodes[0]?.commit.statusCheckRollup ?? null;

  if (rollup === null || rollup.contexts.totalCount === 0) return null;

  return { state: CHECK_STATES.get(rollup.state) ?? "pending", total: rollup.contexts.totalCount };
};

const memberOf = (pull: StackMember): StackMemberView => ({
  id: pull.id,
  number: pull.number,
  title: pull.title,
  url: pull.url,
  headRefName: pull.headRefName,
  status: pullStatus(pull.state, pull.isDraft),
  additions: pull.additions,
  deletions: pull.deletions,
  checks: checksOf(pull.commits),
});

/** GitHub's stack, bottom to top; null for a pull request outside one. */
export const githubStack = (
  stack: GitHubStack | null | undefined,
  entry: { readonly position: number } | null | undefined
): StackView | null => {
  if (stack === null || stack === undefined || entry === null || entry === undefined) return null;

  const members = stack.entries.nodes
    .toSorted((a, b) => a.position - b.position)
    .flatMap((node) => (node.pullRequest === null ? [] : [memberOf(node.pullRequest)]));

  return {
    source: "github",
    number: stack.number,
    trunk: stack.baseRefName,
    position: entry.position,
    size: stack.size,
    members,
  };
};

const rowMember = (row: PullRowView): StackMemberView => ({
  id: row.id,
  number: row.number,
  title: row.title,
  url: row.url,
  headRefName: row.headRefName,
  status: row.isDraft ? "draft" : "open",
  additions: row.additions,
  deletions: row.deletions,
  checks: row.checks ?? null,
});

const repoOf = (row: PullRowView) => `${row.host ?? ""}/${row.repo}`.toLowerCase();

/** The linear chain through a pull request, bottom first; null for a branch point or a cycle. */
const chainOf = (
  row: PullRowView,
  byHead: ReadonlyMap<string, PullRowView>,
  children: ReadonlyMap<string, ReadonlyArray<PullRowView>>
): ReadonlyArray<PullRowView> | null => {
  const seen = new Set<string>([row.id]);
  let bottom = row;

  for (let below = byHead.get(bottom.baseRefName); below !== undefined;) {
    if (seen.has(below.id)) return null;
    seen.add(below.id);
    bottom = below;
    below = byHead.get(bottom.baseRefName);
  }

  const chain = [bottom];

  for (let above = children.get(bottom.headRefName) ?? []; above.length > 0;) {
    // Two pull requests on one base: a tree, not a stack.
    if (above.length > 1) return null;

    const next = above[0]!;

    if (chain.some((r) => r.id === next.id)) return null;
    chain.push(next);
    above = children.get(next.headRefName) ?? [];
  }

  return chain;
};

/**
 * Stacks for one repository's open pull requests without a GitHub stack: a base that is
 * another's head, down to the first base that isn't (the trunk). Forks never stack.
 */
const inferRepo = (rows: ReadonlyArray<PullRowView>): ReadonlyMap<string, StackView> => {
  const heads = new Map<string, Array<PullRowView>>();

  for (const row of rows) heads.set(row.headRefName, [...(heads.get(row.headRefName) ?? []), row]);

  // A head branch two pull requests share can't say which one a base means.
  const byHead = new Map(
    [...heads].flatMap(([head, all]) => (all.length === 1 ? [[head, all[0]!] as const] : []))
  );

  const children = new Map<string, Array<PullRowView>>();

  for (const row of rows) {
    if (byHead.has(row.baseRefName)) {
      children.set(row.baseRefName, [...(children.get(row.baseRefName) ?? []), row]);
    }
  }

  const stacks = new Map<string, StackView>();

  for (const row of rows) {
    const chain = chainOf(row, byHead, children);

    if (chain === null || chain.length < 2) continue;

    stacks.set(row.id, {
      source: "inferred",
      number: null,
      trunk: chain[0]!.baseRefName,
      position: chain.findIndex((r) => r.id === row.id) + 1,
      size: chain.length,
      members: chain.map(rowMember),
    });
  }

  return stacks;
};

/** Every listed row's stack: GitHub's when it has one, else inferred among its repository's. */
export const withStacks = <A extends PullRowView>(rows: ReadonlyArray<A>): ReadonlyArray<A> => {
  const candidates = new Map<string, Array<PullRowView>>();

  for (const row of rows) {
    if ((row.stack ?? null) !== null || row.fromFork === true) continue;

    const key = repoOf(row);
    const list = candidates.get(key) ?? [];

    if (!list.some((r) => r.id === row.id)) list.push(row);
    candidates.set(key, list);
  }

  const inferred = new Map(
    [...candidates.values()].flatMap((repoRows) => [...inferRepo(repoRows)])
  );

  return rows.map((row) => {
    const stack = inferred.get(row.id);

    return stack === undefined ? row : { ...row, stack };
  });
};
