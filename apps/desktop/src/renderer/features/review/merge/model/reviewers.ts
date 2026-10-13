/**
 * The Reviewers control's words and rows (DESIGN.md, Review → Reviewers): the header's
 * compact label, each review's state, and who can still be asked. Pure.
 */
import type {
  ReviewersView,
  ReviewerView,
  ReviewState,
} from "../../../../../shared/githubActions.ts";

/** Everyone asked or who reviewed, once each, asked first. */
export const peopleOf = (view: ReviewersView): ReadonlyArray<string> => [
  ...new Set([...view.requested.map((r) => r.login), ...view.reviewed.map((r) => r.login)]),
];

/** "Request reviewers", the one name, or "3 reviewers". */
export const reviewersLabel = (view: ReviewersView) => {
  const people = peopleOf(view);
  const [only] = people;

  if (only === undefined) return "Request reviewers";

  return people.length === 1 ? only : `${people.length} reviewers`;
};

export const REVIEW_STATE: Readonly<Record<ReviewState, string>> = {
  approved: "approved",
  "changes-requested": "requested changes",
  commented: "commented",
  dismissed: "dismissed",
  pending: "pending",
};

const key = (r: ReviewerView) => `${r.kind}:${r.login.toLowerCase()}`;

/** Who can be asked: GitHub's suggestions, or the search's matches, less the asked and the author. */
export const candidatesOf = (
  view: ReviewersView,
  results: ReadonlyArray<ReviewerView> | null
): ReadonlyArray<ReviewerView> => {
  const asked = new Set(view.requested.map(key));
  const author = view.author?.toLowerCase() ?? null;

  return (results ?? view.suggested).filter(
    (r) => !asked.has(key(r)) && !(r.kind === "user" && r.login.toLowerCase() === author)
  );
};

/** A reviewed person (not the viewer) who isn't asked again yet, so the row offers "Ask again". */
export const canAskAgain = (view: ReviewersView, login: string, viewer: string | null) =>
  login !== viewer &&
  login !== view.author &&
  !view.requested.some((r) => r.kind === "user" && r.login === login);
