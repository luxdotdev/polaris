/** The `github.*` requests and feeds behind the typed bridge. Tokens never cross it. */
import { Effect, Stream, SubscriptionRef } from "effect";
import type { GitHubRequestInputs, GitHubSubscriptionInputs } from "../../shared/githubContract.ts";
import { toIpcError } from "../hosts.ts";
import type { Feed } from "../ipc/feeds.ts";
import type { Handler } from "../ipc/requests.ts";
import { GitHub } from "./index.ts";

type Failure = { readonly _tag: string; readonly message: string };

const gh = <A, E extends Failure>(use: (github: GitHub["Service"]) => Effect.Effect<A, E>) =>
  GitHub.use(use).pipe(Effect.mapError(toIpcError));

const done = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.as(effect, null);

type GitHubHandlers = { readonly [M in keyof typeof GitHubRequestInputs]: Handler<M> };

export const githubHandlers: GitHubHandlers = {
  "github.signIn.start": ({ host }) => gh((g) => g.startSignIn(host)),
  "github.hosts.add": (input) => gh((g) => Effect.map(g.addHost(input), (host) => ({ host }))),
  "github.hosts.remove": ({ host }) => gh((g) => g.removeHost(host)).pipe(done),
  "github.signIn.cancel": () => gh((g) => g.cancelSignIn).pipe(done),
  "github.accounts.remove": ({ accountId }) => gh((g) => g.removeAccount(accountId)).pipe(done),
  "github.accounts.reorder": ({ accountIds }) =>
    gh((g) => g.reorderAccounts(accountIds)).pipe(done),
  "github.routing.setOwner": ({ host, owner, accountId }) =>
    gh((g) => g.setOwner(owner, accountId, host)).pipe(done),
  "github.routing.setWorkspace": ({ workspace, accountId }) =>
    gh((g) => g.setWorkspace(workspace, accountId)).pipe(done),
  "github.watch": ({ workspaces }) => gh((g) => g.watch(workspaces)).pipe(done),
  "github.refresh": () => gh((g) => g.refresh).pipe(done),
  "github.recheck": ({ repo }) => gh((g) => g.recheck(repo)).pipe(done),
  "github.pull.comment": (input) => gh((g) => g.comment(input)),
  "github.bot.command": (input) => gh((g) => g.botCommand(input)).pipe(done),
  "github.pull.publishDescription": (input) => gh((g) => g.publishDescription(input)),
  "github.pull.detail": ({ pull, refresh }) => gh((g) => g.detail(pull, refresh)),
  "github.pull.create": (input) => gh((g) => g.createPull(input)),
  "github.pull.compare": (input) => gh((g) => g.compare(input)),
  "github.review.addThread": (input) => gh((g) => g.addThread(input)),
  "github.review.reply": (input) => gh((g) => g.reply(input)),
  "github.review.resolve": (input) => gh((g) => g.resolveThread(input)).pipe(done),
  "github.review.editComment": (input) => gh((g) => g.editComment(input)).pipe(done),
  "github.review.submit": (input) => gh((g) => g.submitReview(input)).pipe(done),
  "github.review.discard": (input) => gh((g) => g.discardReview(input)).pipe(done),
  "github.files.setViewed": (input) => gh((g) => g.setViewed(input)).pipe(done),
  "github.checkouts.watch": ({ checkouts, group }) =>
    gh((g) => g.watchCheckouts(checkouts, group)).pipe(done),
};

type GitHubOpeners = {
  readonly [K in keyof typeof GitHubSubscriptionInputs]: () => Feed<K>;
};

export const githubOpeners: GitHubOpeners = {
  "github.details": () => Stream.unwrap(GitHub.useSync((g) => SubscriptionRef.changes(g.details))),
  "github.accounts": () =>
    Stream.unwrap(GitHub.useSync((g) => SubscriptionRef.changes(g.accounts))),
  "github.pulls": () => Stream.unwrap(GitHub.useSync((g) => SubscriptionRef.changes(g.pulls))),
  "github.checkouts": () =>
    Stream.unwrap(GitHub.useSync((g) => SubscriptionRef.changes(g.checkouts))),
};
