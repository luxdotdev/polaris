import { Redacted, Schema } from "effect";
import type { BetterAuthPlugin } from "better-auth";
import type { OAuth2Tokens, OAuthProvider } from "@better-auth/core/oauth2";
import { authorizationCodeRequest, getOAuth2Tokens } from "@better-auth/core/oauth2";
import type { GithubOptions } from "@better-auth/core/social-providers";
import type { GitHubConfig } from "../config.ts";
import { defaultCommitEmail, fetchEmails, fetchUser } from "../github/index.ts";

const decodeTokenResponse = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

/** Better Auth's `socialProviders.github` options for this server's GitHub. */
export const githubProvider = (github: GitHubConfig): GithubOptions => ({
  clientId: github.clientId,
  clientSecret: Redacted.value(github.clientSecret),
  authorizationEndpoint: `${github.webUrl}/login/oauth/authorize`,
  overrideUserInfoOnSignIn: true,
});

/** The person behind a GitHub token: name and avatar, login, and their primary verified address. */
const userInfo = async (github: GitHubConfig, token: OAuth2Tokens) => {
  if (token.accessToken === undefined) return null;

  const [user, emails] = await Promise.all([
    fetchUser(github, token.accessToken),
    fetchEmails(github, token.accessToken),
  ]);

  const githubId = String(user.id);

  return {
    user: {
      name: user.name ?? user.login,
      email: defaultCommitEmail(github, { githubId, login: user.login }, emails),
      image: user.avatar_url,
      emailVerified: true,
      login: user.login,
      githubId,
    },
    data: user,
  };
};

const exchangeCode = async (
  github: GitHubConfig,
  options: GithubOptions,
  input: { code: string; codeVerifier?: string | undefined; redirectURI: string }
) => {
  const { body, headers } = await authorizationCodeRequest({ ...input, options });

  const response = await fetch(`${github.webUrl}/login/oauth/access_token`, {
    method: "POST",
    body,
    headers: { ...headers, accept: "application/json" },
    redirect: "error",
  });

  if (!response.ok) return null;

  const data = decodeTokenResponse(await response.json());

  return "error" in data ? null : getOAuth2Tokens(data);
};

/**
 * Points the GitHub provider at `github.webUrl` and `github.apiUrl`, which Better Auth fixes to
 * github.com; this is what lets GitHub Enterprise Server or a test's fake GitHub sign people in.
 */
export const githubHost = (github: GitHubConfig): BetterAuthPlugin => ({
  id: "polaris-github-host",
  init: (ctx) => ({
    context: {
      socialProviders: ctx.socialProviders.map((provider): OAuthProvider =>
        provider.id !== "github"
          ? provider
          : {
              ...provider,
              validateAuthorizationCode: (input) =>
                exchangeCode(github, githubProvider(github), input),
              getUserInfo: (token) => userInfo(github, token),
            }
      ),
    },
  }),
});
