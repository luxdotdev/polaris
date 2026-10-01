/**
 * Opens a pull request as the account routed to the repository, for an accepted
 * Agent Session's work (ENG-224). The push itself uses the Host's git credentials.
 */
import { Effect } from "effect";
import type { RepoRef, WorkspaceRef } from "../../shared/github.ts";
import type { Client } from "./client.ts";
import { GitHubNoAccount, GitHubRequestError } from "./errors.ts";
import type { Routing } from "./routing.ts";
import { CreatedPull } from "./wire.ts";

export interface NewPull {
  readonly repo: RepoRef;
  /** The pushed branch; `owner:branch` for a fork. */
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
  readonly workspace?: WorkspaceRef;
}

export interface CreatedPullView {
  readonly id: string;
  readonly number: number;
  readonly url: string;
}

export const newCreate = (client: Client, routing: Routing) => (input: NewPull) =>
  Effect.gen(function* () {
    const access = yield* routing.resolve(input.repo, input.workspace ?? null);
    const name = `${input.repo.owner}/${input.repo.name}`;

    if (access.accountId === null) {
      return yield* Effect.fail(
        new GitHubNoAccount({ repo: name, message: `No GitHub account can see ${name}.` })
      );
    }

    const result = yield* client.rest(access.accountId, CreatedPull, {
      method: "POST",
      path: `/repos/${input.repo.owner}/${input.repo.name}/pulls`,
      etag: null,
      body: {
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
        draft: input.draft,
      },
    });

    if (result.status !== "ok") {
      return yield* Effect.fail(new GitHubRequestError({ status: 304, message: "unexpected 304" }));
    }

    return {
      id: result.value.node_id,
      number: result.value.number,
      url: result.value.html_url,
    } satisfies CreatedPullView;
  });
