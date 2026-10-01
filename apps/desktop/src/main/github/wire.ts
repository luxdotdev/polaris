/** GitHub's REST and OAuth responses, as far as Polaris reads them. */
import { Schema } from "effect";

/** `POST /login/device/code`. */
export const DeviceCode = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
});

export type DeviceCode = typeof DeviceCode.Type;

/** `POST /login/oauth/access_token`: a token, or an `error` (still HTTP 200). */
export const TokenResponse = Schema.Struct({
  access_token: Schema.optionalKey(Schema.String),
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  refresh_token_expires_in: Schema.optionalKey(Schema.Number),
  scope: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  error_description: Schema.optionalKey(Schema.String),
  interval: Schema.optionalKey(Schema.Number),
});

export type TokenResponse = typeof TokenResponse.Type;

/** `GET /user`. */
export const User = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar_url: Schema.String,
});

export type User = typeof User.Type;

/** One item of `GET /repos/{owner}/{repo}/pulls`: only what tells Polaris something changed. */
export const RestPull = Schema.Struct({
  number: Schema.Number,
  updated_at: Schema.String,
  head: Schema.Struct({ sha: Schema.String }),
});

export const RestPulls = Schema.Array(RestPull);

/** `POST /repos/{owner}/{repo}/pulls`. */
export const CreatedPull = Schema.Struct({
  node_id: Schema.String,
  number: Schema.Number,
  html_url: Schema.String,
});

export type CreatedPull = typeof CreatedPull.Type;

/** `GET /repos/{owner}/{repo}/compare/{base}...{head}`: what a Review Checkout's update brings. */
export const Comparison = Schema.Struct({
  status: Schema.String,
  total_commits: Schema.Number,
  commits: Schema.Array(
    Schema.Struct({
      sha: Schema.String,
      commit: Schema.Struct({
        message: Schema.String,
        committer: Schema.NullOr(Schema.Struct({ date: Schema.String })),
      }),
    })
  ),
});

export type Comparison = typeof Comparison.Type;
