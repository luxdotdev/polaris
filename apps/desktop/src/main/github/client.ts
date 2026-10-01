/**
 * Calls as an account: takes its token, and after a 401 refreshes once and
 * retries. A second 401, or a failed refresh, signs the account out.
 */
import { Effect, type Schema } from "effect";
import type { Credentials } from "./credentials.ts";
import type { GitHubCallError } from "./errors.ts";
import type { Accounts } from "./accounts.ts";
import type { Caller, GraphQLRequest, RestRequest, Transport } from "./transport.ts";

type Decodable = Schema.Top & { readonly DecodingServices: never };

export const newClient = (transport: Transport, credentials: Credentials, accounts: Accounts) => {
  const asAccount = <A>(
    accountId: number,
    run: (caller: Caller) => Effect.Effect<A, GitHubCallError>
  ) =>
    Effect.gen(function* () {
      const { endpoints } = yield* accounts.accessOf(accountId);
      const token = yield* credentials.token(accountId);

      return yield* run({ accountId, token, endpoints }).pipe(
        Effect.catchTag("GitHubAuthError", () =>
          Effect.flatMap(credentials.renew(accountId, token), (renewed) =>
            run({ accountId, token: renewed, endpoints })
          )
        )
      );
    });

  const rest = <S extends Decodable>(accountId: number, schema: S, request: RestRequest) =>
    asAccount(accountId, (caller) => transport.rest(caller, schema, request));

  const graphql = <S extends Decodable>(accountId: number, schema: S, request: GraphQLRequest) =>
    asAccount(accountId, (caller) => transport.graphql(caller, schema, request));

  return { rest, graphql, budget: transport.budget };
};

export type Client = ReturnType<typeof newClient>;
