/**
 * A four-layer GitHub stack for the previews (`#review/stacked`, `#pulls/list`), after the
 * stack the user reviewed: layer 2 of 4 on `nightly`, with long branch names.
 */
import type { PullDetailView, PullRowView, StackView } from "../../../../shared/github.ts";

const branch = (n: number, rest: string) => `lpark/eng-${n}-admin-impersonation-${rest}`;

const member = (
  number: number,
  title: string,
  head: string,
  additions: number,
  deletions: number,
  checks: StackView["members"][number]["checks"]
) => ({
  id: `PR_${number}`,
  number,
  title,
  url: `https://github.com/work-org/nj-homes-choice-next/pull/${number}`,
  headRefName: head,
  status: "open" as const,
  additions,
  deletions,
  checks,
});

const L1 = branch(1843, "sign-in-as-a-planner-read-only-and");

const L2 = branch(1845, "record-every-start-and-stop-through-our");

export const STACK: StackView = {
  source: "github",
  number: 635,
  trunk: "nightly",
  position: 2,
  size: 4,
  members: [
    member(613, "feat(auth): make impersonated sessions read-only (ENG-1843)", L1, 109, 23, {
      state: "success",
      total: 13,
    }),
    member(632, "feat(auth): audit impersonation start and stop (ENG-1845)", L2, 615, 14, {
      state: "success",
      total: 4,
    }),
    member(
      633,
      "feat(admin): sign in as a planner from Users (ENG-1846)",
      branch(1846, "from-users"),
      409,
      34,
      {
        state: "pending",
        total: 10,
      }
    ),
    member(
      634,
      "feat(vacant-land): show planner controls disabled while impersonating",
      branch(1847, "show-planner-controls-disabled"),
      91,
      19,
      { state: "failure", total: 2 }
    ),
  ],
};

/** Layer 2's detail: based on layer 1's head, not the trunk. */
export const stackedDetail = (base: PullDetailView): PullDetailView => ({
  ...base,
  id: "PR_632",
  number: 632,
  title: "feat(auth): audit impersonation start and stop (ENG-1845)",
  url: "https://github.com/work-org/nj-homes-choice-next/pull/632",
  author: { login: "lpark", avatarUrl: "" },
  headRefName: L2,
  baseRefName: L1,
  commits: 5,
  checks: { state: "success", total: 4 },
  stack: STACK,
});

/** The same layer as a pull list row. */
export const stackedRow = (base: PullRowView): PullRowView => ({
  ...base,
  id: "PR_632",
  number: 632,
  title: "feat(auth): audit impersonation start and stop (ENG-1845)",
  headRefName: L2,
  baseRefName: L1,
  additions: 615,
  deletions: 14,
  stack: STACK,
});
