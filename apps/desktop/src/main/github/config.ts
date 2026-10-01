/**
 * Where the GitHub client talks to: github.com by default, or a local fake for
 * tests and the smoke (`POLARIS_GITHUB_WEB_URL`, `POLARIS_GITHUB_API_URL`).
 */
import { GITHUB_CLIENT_ID } from "../../shared/github.ts";

export interface GitHubEndpoints {
  /** OAuth and the pages a user opens: `https://github.com`. */
  readonly web: string;
  /** REST, and GraphQL at `/graphql`: `https://api.github.com`. */
  readonly api: string;
}

export const GITHUB_DOT_COM: GitHubEndpoints = {
  web: "https://github.com",
  api: "https://api.github.com",
};

/** The process environment. */
export type EndpointEnv = NodeJS.ProcessEnv;

export const endpointsFrom = (env: EndpointEnv): GitHubEndpoints => ({
  web: env["POLARIS_GITHUB_WEB_URL"] ?? GITHUB_DOT_COM.web,
  api: env["POLARIS_GITHUB_API_URL"] ?? GITHUB_DOT_COM.api,
});

/** Authorized OAuth Apps → Polaris: review, revoke, or request an org's approval. */
export const manageUrl = (endpoints: GitHubEndpoints) =>
  `${endpoints.web}/settings/connections/applications/${GITHUB_CLIENT_ID}`;

/** Starts a SAML SSO session for an organization. */
export const ssoUrl = (endpoints: GitHubEndpoints, org: string) =>
  `${endpoints.web}/orgs/${encodeURIComponent(org)}/sso`;
