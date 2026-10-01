/**
 * Calls as an account: takes its token, and after a 401 refreshes once and
 * retries. A second 401, or a failed refresh, signs the account out.
 */
import { Effect, type Schema } from "effect";
import type { Credentials } from "./credentials.ts";
import type { GitHubCallError } from "./errors.ts";
import type { GraphQLRequest, RestRequest, Transport } from "./transport.ts";

type Decodable = Schema.Top & { readonly DecodingServices: never };

export const newClient = (transport: Transport, credentials: Credentials) => {
  const asAccount = <A>(
    accountId: number,
    run: (token: string) => Effect.Effect<A, GitHubCallError>
  ) =>
    Effect.flatMap(credentials.token(accountId), (token) =>
      run(token).pipe(
        Effect.catchTag("GitHubAuthError", () =>
          Effect.flatMap(credentials.renew(accountId, token), run)
        )
      )
    );

  const rest = <S extends Decodable>(accountId: number, schema: S, request: RestRequest) =>
    asAccount(accountId, (token) => transport.rest({ accountId, token }, schema, request));

  const graphql = <S extends Decodable>(accountId: number, schema: S, request: GraphQLRequest) =>
    asAccount(accountId, (token) => transport.graphql({ accountId, token }, schema, request));

  return { rest, graphql, budget: transport.budget };
};

export type Client = ReturnType<typeof newClient>;
