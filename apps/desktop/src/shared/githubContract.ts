/**
 * The `github.*` IPC inputs as Effect Schemas, spread into `RequestInputs` and
 * `SubscriptionInputs`. The renderer imports this for types only; the views it
 * gets back are in `github.ts`.
 */
import { Schema } from "effect";
import type {
  CheckoutStateView,
  CompareView,
  GitHubAccountsView,
  PullDetailView,
  PullListView,
  SignInView,
} from "./github.ts";

const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+$/));

export const RepoRef = Schema.Struct({ owner: Name, name: Name });

export const WorkspaceRef = Schema.Struct({ hostKey: Schema.String, workspaceId: Schema.String });

export const PullRef = Schema.Struct({
  repo: RepoRef,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
});

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{7,64}$/));

const PullOp = { pull: PullRef, pullId: Schema.String };

const DiffSide = Schema.Literals(["left", "right"]);

const AccountId = Schema.Int;

export const GitHubRequestInputs = {
  /** Starts the device flow; the code and its state also arrive on `github.accounts`. */
  "github.signIn.start": Schema.Struct({}),
  "github.signIn.cancel": Schema.Struct({}),
  /** Forgets the account and its tokens here; revoking is on GitHub (`manageUrl`). */
  "github.accounts.remove": Schema.Struct({ accountId: AccountId }),
  "github.accounts.reorder": Schema.Struct({ accountIds: Schema.Array(AccountId) }),
  /** Null clears the mapping. */
  "github.routing.setOwner": Schema.Struct({ owner: Name, accountId: Schema.NullOr(AccountId) }),
  "github.routing.setWorkspace": Schema.Struct({
    workspace: WorkspaceRef,
    accountId: Schema.NullOr(AccountId),
  }),
  /** Every Workspace on every Host with its git remote URLs: the PR list's repositories. */
  "github.watch": Schema.Struct({
    workspaces: Schema.Array(
      Schema.Struct({ workspace: WorkspaceRef, remotes: Schema.Array(Schema.String) })
    ),
  }),
  /** Polls now and searches every account. */
  "github.refresh": Schema.Struct({}),
  /** Checks a blocked repository again (after requesting access or starting SSO). */
  "github.recheck": Schema.Struct({ repo: RepoRef }),
  "github.pull.detail": Schema.Struct({ pull: PullRef }),
  /** The commits between two of a pull request's commits (a Review Checkout's and the head). */
  "github.pull.compare": Schema.Struct({ repo: RepoRef, base: Sha, head: Sha }),
  "github.pull.create": Schema.Struct({
    repo: RepoRef,
    head: Schema.String,
    base: Schema.String,
    title: Schema.String.check(Schema.isMinLength(1)),
    body: Schema.String,
    draft: Schema.Boolean,
    /** The Workspace it's opened from: its account override wins (ENG-185). */
    workspace: Schema.optionalKey(WorkspaceRef),
  }),
  "github.review.addThread": Schema.Struct({
    ...PullOp,
    commitOid: Schema.NullOr(Schema.String),
    path: Schema.String,
    body: Schema.String,
    subjectType: Schema.Literals(["line", "file"]),
    line: Schema.NullOr(Schema.Int),
    side: DiffSide,
    startLine: Schema.NullOr(Schema.Int),
    startSide: Schema.NullOr(DiffSide),
  }),
  "github.review.reply": Schema.Struct({ ...PullOp, threadId: Schema.String, body: Schema.String }),
  "github.review.resolve": Schema.Struct({
    pull: PullRef,
    threadId: Schema.String,
    resolved: Schema.Boolean,
  }),
  /** A null body deletes the comment. */
  "github.review.editComment": Schema.Struct({
    pull: PullRef,
    commentId: Schema.String,
    body: Schema.NullOr(Schema.String),
  }),
  "github.review.submit": Schema.Struct({
    ...PullOp,
    event: Schema.Literals(["approve", "request-changes", "comment"]),
    body: Schema.String,
  }),
  "github.review.discard": Schema.Struct(PullOp),
  "github.files.setViewed": Schema.Struct({
    ...PullOp,
    path: Schema.String,
    viewed: Schema.Boolean,
  }),
  /**
   * Pull requests watched for merge, close and new commits: every Review Checkout's, or
   * (`group: "sessions"`) every accepted Agent Session's. Each group replaces only itself.
   */
  "github.checkouts.watch": Schema.Struct({
    checkouts: Schema.Array(
      Schema.Struct({ key: Schema.String, pull: PullRef, pullId: Schema.String })
    ),
    group: Schema.optionalKey(Schema.Literals(["checkouts", "sessions"])),
  }),
} as const;

export interface GitHubRequestOutputs {
  "github.signIn.start": SignInView;
  "github.signIn.cancel": null;
  "github.accounts.remove": null;
  "github.accounts.reorder": null;
  "github.routing.setOwner": null;
  "github.routing.setWorkspace": null;
  "github.watch": null;
  "github.refresh": null;
  "github.recheck": null;
  "github.pull.detail": PullDetailView;
  "github.pull.compare": CompareView;
  "github.pull.create": { readonly id: string; readonly number: number; readonly url: string };
  "github.review.addThread": { readonly threadId: string; readonly reviewId: string };
  "github.review.reply": { readonly commentId: string };
  "github.review.resolve": null;
  "github.review.editComment": null;
  "github.review.submit": null;
  "github.review.discard": null;
  "github.files.setViewed": null;
  "github.checkouts.watch": null;
}

export const GitHubSubscriptionInputs = {
  /** The accounts for Settings, with any sign-in in progress; the whole view on every change. */
  "github.accounts": Schema.Struct({}),
  /** The pull request list with each repository's access state. */
  "github.pulls": Schema.Struct({}),
  /** The watched Review Checkouts' pull request states, after every poll. */
  "github.checkouts": Schema.Struct({}),
} as const;

export interface GitHubSubscriptionItems {
  "github.accounts": GitHubAccountsView;
  "github.pulls": PullListView;
  "github.checkouts": ReadonlyArray<CheckoutStateView>;
}
