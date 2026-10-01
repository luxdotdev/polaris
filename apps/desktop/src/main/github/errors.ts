/** The GitHub client's failures; each crosses IPC as its tag and message. */
import { Schema } from "effect";

/** The token was revoked or can't be refreshed: the account must sign in again. */
export class GitHubAuthError extends Schema.TaggedError<GitHubAuthError>()("GitHubAuthError", {
  accountId: Schema.Number,
  message: Schema.String,
}) {}

/** A primary or secondary rate limit, or Polaris's own share of it, until `resetAt`. */
export class GitHubRateLimited extends Schema.TaggedError<GitHubRateLimited>()(
  "GitHubRateLimited",
  { resetAt: Schema.Number, message: Schema.String }
) {}

/** 404, or GraphQL `NOT_FOUND`: also what an org's OAuth App restrictions look like. */
export class GitHubNotFound extends Schema.TaggedError<GitHubNotFound>()("GitHubNotFound", {
  message: Schema.String,
}) {}

/** 403 (not a rate limit), or GraphQL `FORBIDDEN`. */
export class GitHubForbidden extends Schema.TaggedError<GitHubForbidden>()("GitHubForbidden", {
  message: Schema.String,
}) {}

/** Anything else: the network, a 5xx, an unexpected response. `status` is 0 without one. */
export class GitHubRequestError extends Schema.TaggedError<GitHubRequestError>()(
  "GitHubRequestError",
  { status: Schema.Number, message: Schema.String }
) {}

/** No signed-in account can reach the repository. */
export class GitHubNoAccount extends Schema.TaggedError<GitHubNoAccount>()("GitHubNoAccount", {
  repo: Schema.String,
  message: Schema.String,
}) {}

/** A review operation GitHub would refuse, caught before asking. */
export class GitHubInvalidReview extends Schema.TaggedError<GitHubInvalidReview>()(
  "GitHubInvalidReview",
  { message: Schema.String }
) {}

/** Tokens can't be stored safely on this machine, or the stored ones can't be read. */
export class GitHubStorageError extends Schema.TaggedError<GitHubStorageError>()(
  "GitHubStorageError",
  { message: Schema.String }
) {}

/** What one call to GitHub can fail with. */
export type GitHubCallError =
  | GitHubAuthError
  | GitHubRateLimited
  | GitHubNotFound
  | GitHubForbidden
  | GitHubRequestError;

/** Not a GitHub Enterprise host Polaris can add, or one nobody added. */
export class GitHubInvalidHost extends Schema.TaggedError<GitHubInvalidHost>()(
  "GitHubInvalidHost",
  { host: Schema.String, message: Schema.String }
) {}
