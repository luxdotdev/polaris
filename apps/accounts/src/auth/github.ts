import { Redacted, Schema } from "effect";
import type { BetterAuthPlugin } from "better-auth";
import type { OAuth2Tokens, OAuthProvider } from "@better-auth/core/oauth2";
import { authorizationCodeRequest, getOAuth2Tokens } from "@better-auth/core/oauth2";
import type { GithubOptions } from "@better-auth/core/social-providers";
import { and, ne, sql } from "drizzle-orm";
import type { GitHubConfig } from "../config.ts";
import type { Database } from "../db/index.ts";
import { user as userTable } from "../db/schema.ts";
import { defaultCommitEmail, fetchEmails, fetchUser, noreplyEmail } from "../github/index.ts";

const decodeTokenResponse = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

/** Better Auth's `socialProviders.github` options for this server's GitHub. */
export const githubProvider = (github: GitHubConfig): GithubOptions => ({
  clientId: github.clientId,
  clientSecret: Redacted.value(github.clientSecret),
  authorizationEndpoint: `${github.webUrl}/login/oauth/authorize`,
  overrideUserInfoOnSignIn: true,
});

/**
 * The person behind a GitHub token. Better Auth's email is their noreply address, unique to the
 * GitHub account, so no two GitHub accounts can ever meet on an address.
 */
const userInfo = async (github: GitHubConfig, db: Database, token: OAuth2Tokens) => {
  if (token.accessToken === undefined) return null;

  const [user, emails] = await Promise.all([
    fetchUser(github, token.accessToken),
    fetchEmails(github, token.accessToken),
  ]);

  const githubId = String(user.id);
  const person = { githubId, login: user.login };

  // Whoever held this login has renamed on GitHub: `~id` (no GitHub login has `~`) until they sign in.
  await db
    .update(userTable)
    .set({ login: sql`'~' || ${userTable.githubId}` })
    .where(
      and(
        sql`lower(${userTable.login}) = ${user.login.toLowerCase()}`,
        ne(userTable.githubId, githubId)
      )
    );

  return {
    user: {
      name: user.name ?? user.login,
      email: noreplyEmail(github, person),
      primaryEmail: defaultCommitEmail(github, person, emails),
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
export const githubHost = (github: GitHubConfig, db: Database): BetterAuthPlugin => ({
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
              getUserInfo: (token) => userInfo(github, db, token),
            }
      ),
    },
  }),
});
