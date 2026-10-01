/**
 * Where the GitHub client talks to, per host. github.com: `api.github.com`.
 * GitHub Enterprise Server: `https://<host>/api/v3` and `/api/graphql`; GHE.com
 * (`<name>.ghe.com`): `api.<name>.ghe.com`. Tests and the smoke point hosts at a fake.
 */
import { GITHUB_CLIENT_ID, GITHUB_HOST } from "../../shared/github.ts";

export interface GitHubEndpoints {
  /** OAuth and the pages a user opens: `https://github.com`. */
  readonly web: string;
  /** REST: `https://api.github.com`, `https://<host>/api/v3`. */
  readonly api: string;
  /** `https://api.github.com/graphql`, `https://<host>/api/graphql`. */
  readonly graphql: string;
}

/** The URLs a run starts from: github.com's (or a fake's), and other hosts' base URLs. */
export interface EndpointConfig {
  readonly web: string;
  readonly api: string;
  /** Host → its base URL (scheme and authority) instead of `https://<host>`; for fakes. */
  readonly hostUrls?: Readonly<Record<string, string>>;
}

export const GITHUB_DOT_COM: EndpointConfig = {
  web: "https://github.com",
  api: "https://api.github.com",
};

/** The process environment. */
export type EndpointEnv = NodeJS.ProcessEnv;

const parseHostUrls = (json: string | undefined): Readonly<Record<string, string>> => {
  if (json === undefined || json === "") return {};

  try {
    const parsed: unknown = JSON.parse(json);

    return Object.fromEntries(
      Object.entries(parsed ?? {}).filter((entry): entry is [string, string] =>
        /^https?:\/\//.test(String(entry[1]))
      )
    );
  } catch {
    return {};
  }
};

/** `POLARIS_GITHUB_WEB_URL` / `_API_URL` for github.com, `POLARIS_GITHUB_HOST_URLS` (JSON) for the rest. */
export const endpointsFrom = (env: EndpointEnv): EndpointConfig => ({
  web: env["POLARIS_GITHUB_WEB_URL"] ?? GITHUB_DOT_COM.web,
  api: env["POLARIS_GITHUB_API_URL"] ?? GITHUB_DOT_COM.api,
  hostUrls: parseHostUrls(env["POLARIS_GITHUB_HOST_URLS"]),
});

/** One host's endpoints: github.com, a GHE.com tenant, or a GitHub Enterprise Server. */
export const endpointsFor = (config: EndpointConfig, host: string): GitHubEndpoints => {
  if (host === GITHUB_HOST)
    return { web: config.web, api: config.api, graphql: `${config.api}/graphql` };

  const base = config.hostUrls?.[host];

  if (base === undefined && host.endsWith(".ghe.com")) {
    return {
      web: `https://${host}`,
      api: `https://api.${host}`,
      graphql: `https://api.${host}/graphql`,
    };
  }

  const web = (base ?? `https://${host}`).replace(/\/+$/, "");

  return { web, api: `${web}/api/v3`, graphql: `${web}/api/graphql` };
};

/** Authorized OAuth Apps → Polaris: review, revoke, or request an org's approval. */
export const manageUrl = (endpoints: GitHubEndpoints, clientId: string = GITHUB_CLIENT_ID) =>
  `${endpoints.web}/settings/connections/applications/${clientId}`;

/** Starts a SAML SSO session for an organization. */
export const ssoUrl = (endpoints: GitHubEndpoints, org: string) =>
  `${endpoints.web}/orgs/${encodeURIComponent(org)}/sso`;
