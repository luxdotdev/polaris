/**
 * Polaris accounts on a Client (ENG-944, ADR 0112): `Accounts`, the Account Server's contract
 * (apps/accounts/README.md) as Schemas, and the store each app backs with its secret store.
 */
export * from "./contract.ts";

export { type AccountServer, accountServer, type Fetch } from "./http.ts";

export {
  accountServerOrigin,
  isPolarisCloud,
  pkceSecrets,
  type Pkce,
  signInUrl,
} from "./server.ts";

export * from "./service.ts";

export * from "./store.ts";
