import { Clock, Effect, Schema, Semaphore } from "effect";
import { repoKey, type PullRef } from "../../shared/github.ts";
import { GitHubInvalidReview } from "./errors.ts";
import type { Reviews } from "./reviews.ts";
import { descriptionHash, publications } from "./publication.ts";

export interface BotCommand {
  readonly pull: PullRef;
  readonly bot: string;
  readonly command: "review" | "retry" | "memory";
  readonly text?: string;
}

export interface PublishDescription {
  readonly pull: PullRef;
  readonly pullId: string;
  readonly body: string;
  readonly head: string;
}

const AddCommentData = Schema.Struct({
  addComment: Schema.Struct({
    commentEdge: Schema.Struct({ node: Schema.Struct({ id: Schema.String, url: Schema.String }) }),
  }),
});

const UpdatedPullData = Schema.Struct({
  updatePullRequest: Schema.Struct({
    pullRequest: Schema.Struct({
      id: Schema.String,
      body: Schema.String,
      headRefOid: Schema.String,
    }),
  }),
});

const reject = (message: string) => Effect.fail(new GitHubInvalidReview({ message }));

export const newOverviewActions = (reviews: Reviews, path: string) => {
  const records = publications(path);
  const key = (pull: PullRef) => `${repoKey(pull.repo)}#${pull.number}`;
  const lock = Semaphore.makeUnsafe(1);

  const detail = (pull: PullRef, fresh = false) =>
    Effect.gen(function* () {
      const view = yield* reviews.detail(pull, fresh);

      return { ...view, published: yield* records.get(key(pull), view.body) };
    });

  const comment = (input: { readonly pull: PullRef; readonly body: string }) =>
    Effect.gen(function* () {
      if (input.body.trim() === "") return yield* reject("A comment needs some text.");
      const view = yield* detail(input.pull);
      const accountId = yield* reviews.accountFor(input.pull);

      const posted = yield* reviews.mutate(accountId, AddCommentData, {
        operationName: "AddIssueComment",
        query:
          "mutation AddIssueComment($input: AddCommentInput!) { addComment(input:$input) { commentEdge { node { id url } } } }",
        variables: { input: { subjectId: view.id, body: input.body } },
      });

      return posted.addComment.commentEdge.node;
    });

  const botCommand = (input: BotCommand) =>
    Effect.gen(function* () {
      const view = yield* detail(input.pull);

      if (view.botSummary?.bot !== input.bot.toLowerCase())
        return yield* reject("This pull request has no summary from that bot.");
      const text = input.text?.trim() ?? "";

      if (input.command === "memory" && text === "")
        return yield* reject("Teaching a bot needs some guidance.");
      const body = input.command === "memory" ? `/memory ${text}` : `/${input.command}`;

      yield* comment({ pull: input.pull, body });
    });

  const publishDescription = (input: PublishDescription) =>
    lock.withPermit(
      Effect.gen(function* () {
        const view = yield* detail(input.pull, true);

        if (view.id !== input.pullId) return yield* reject("The pull request changed.");

        if (view.author?.login !== view.viewerLogin)
          return yield* reject("Only the author can publish a walkthrough as the description.");

        if (view.headRefOid !== input.head)
          return yield* reject("New commits arrived. Refresh the walkthrough before publishing.");

        if (input.body.trim() === "") return yield* reject("The walkthrough is empty.");
        const accountId = yield* reviews.accountFor(input.pull);

        const updated = yield* reviews.mutate(accountId, UpdatedPullData, {
          operationName: "PublishDescription",
          query:
            "mutation PublishDescription($input: UpdatePullRequestInput!) { updatePullRequest(input:$input) { pullRequest { id body headRefOid } } }",
          variables: { input: { pullRequestId: view.id, body: input.body } },
        });

        const hash = descriptionHash(updated.updatePullRequest.pullRequest.body);
        const now = yield* Clock.currentTimeMillis;

        yield* records.set(key(input.pull), {
          hash,
          head: input.head,
          at: new Date(now).toISOString(),
        });

        return { hash };
      })
    );

  const cached = () =>
    Effect.suspend(() =>
      Effect.forEach(reviews.cachedDetails(), (view) =>
        Effect.map(
          records.get(
            `${view.host === undefined || view.host === "github.com" ? view.repo : `${view.host}/${view.repo}`}#${view.number}`.toLowerCase(),
            view.body
          ),
          (published) => ({ ...view, published })
        )
      )
    );

  return { cached, detail, comment, botCommand, publishDescription };
};
