import { Schema } from "effect";
import type { GitHubConfig } from "../config.ts";

/** The fields of GitHub's `GET /user` the Account Server keeps. */
export const GitHubUser = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar_url: Schema.String,
});

export type GitHubUser = typeof GitHubUser.Type;

export const GitHubEmail = Schema.Struct({
  email: Schema.String,
  primary: Schema.Boolean,
  verified: Schema.Boolean,
});

export type GitHubEmail = typeof GitHubEmail.Type;

const decodeUser = Schema.decodeUnknownPromise(GitHubUser);

const decodeEmails = Schema.decodeUnknownPromise(Schema.Array(GitHubEmail));

export class GitHubRequestFailed extends Schema.TaggedError<GitHubRequestFailed>()(
  "GitHubRequestFailed",
  {
    path: Schema.String,
    status: Schema.Number,
  }
) {}

const getJson = async (github: GitHubConfig, path: string, accessToken: string) => {
  const response = await fetch(`${github.apiUrl}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "polaris-accounts",
    },
  });

  if (!response.ok) throw new GitHubRequestFailed({ path, status: response.status });

  return response.json();
};

export const fetchUser = async (github: GitHubConfig, accessToken: string) =>
  decodeUser(await getJson(github, "/user", accessToken));

/** The person's addresses; needs the `user:email` scope. */
export const fetchEmails = async (github: GitHubConfig, accessToken: string) =>
  decodeEmails(await getJson(github, "/user/emails", accessToken));

/** GitHub's private commit address for a person, `ID+login@users.noreply.<host>`. */
export const noreplyEmail = (
  github: GitHubConfig,
  user: { readonly githubId: string; readonly login: string }
) => `${user.githubId}+${user.login}@users.noreply.${new URL(github.webUrl).hostname}`;

/** The addresses a person may commit as: their verified GitHub addresses, primary first, then noreply. */
export const commitEmailChoices = (
  github: GitHubConfig,
  user: { readonly githubId: string; readonly login: string },
  emails: ReadonlyArray<GitHubEmail>
): ReadonlyArray<string> => {
  const verified = emails
    .filter((e) => e.verified)
    .toSorted((a, b) => Number(b.primary) - Number(a.primary))
    .map((e) => e.email);

  const noreply = noreplyEmail(github, user);

  return verified.includes(noreply) ? verified : [...verified, noreply];
};

/** The primary verified address, else the noreply one. */
export const defaultCommitEmail = (
  github: GitHubConfig,
  user: { readonly githubId: string; readonly login: string },
  emails: ReadonlyArray<GitHubEmail>
) => emails.find((e) => e.primary && e.verified)?.email ?? noreplyEmail(github, user);
