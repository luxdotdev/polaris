/**
 * One HTTP call to GitHub: REST, GraphQL or OAuth. Maps statuses to the client's
 * errors, records each response's rate limit in the Budget, and decodes bodies with
 * Effect Schema at the boundary. Tokens come from the caller; nothing here refreshes.
 */
import { Effect, Option, Schema } from "effect";
import type { Budget, Resource } from "./budget.ts";
import type { GitHubEndpoints } from "./config.ts";
import {
  GitHubAuthError,
  type GitHubCallError,
  GitHubForbidden,
  GitHubNotFound,
  GitHubRateLimited,
  GitHubRequestError,
} from "./errors.ts";

/** `fetch`, or the recorded fake's handler in tests. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A JSON value: what request bodies and GraphQL variables are made of. */
export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

export interface Caller {
  readonly accountId: number;
  readonly token: string;
  /** The account's host. */
  readonly endpoints: GitHubEndpoints;
}

export interface RestRequest {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  /** The saved ETag: a 304 answer costs nothing against the limit. */
  readonly etag: string | null;
  readonly body: Json | null;
}

export type RestResult<A> =
  | { readonly status: "ok"; readonly etag: string | null; readonly value: A }
  | { readonly status: "not-modified" };

export interface GraphQLRequest {
  /** Must match the operation's name in `query`; the fake dispatches on it. */
  readonly operationName: string;
  readonly query: string;
  readonly variables: { readonly [key: string]: Json };
}

export interface TransportInput {
  readonly fetch: Fetch;
  readonly budget: Budget;
  readonly now: () => number;
}

const GraphQLError = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  message: Schema.String,
});

const ErrorBody = Schema.Struct({ message: Schema.optionalKey(Schema.String) });

const decodeErrorBody = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorBody));

const headerInt = (headers: Headers, name: string) => {
  const value = headers.get(name);
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : null;
};

const messageOf = (text: string, fallback: string) =>
  decodeErrorBody(text).pipe(
    Option.flatMapNullishOr((body) => body.message),
    Option.getOrElse(() => fallback)
  );

const withHeader = (headers: Headers, name: string, value: string) => {
  headers.set(name, value);

  return headers;
};

export const newTransport = ({ fetch, budget, now }: TransportInput) => {
  const headers = (caller: Caller) =>
    new Headers({
      accept: "application/vnd.github+json",
      authorization: `Bearer ${caller.token}`,
      "content-type": "application/json",
      "user-agent": "Polaris",
      "x-github-api-version": "2022-11-28",
    });

  const record = (caller: Caller, response: Response, fallback: Resource, cost: number) => {
    const limit = headerInt(response.headers, "x-ratelimit-limit");
    const remaining = headerInt(response.headers, "x-ratelimit-remaining");
    const reset = headerInt(response.headers, "x-ratelimit-reset");

    const resource =
      response.headers.get("x-ratelimit-resource") === "graphql" ? "graphql" : fallback;

    if (limit === null || remaining === null || reset === null) return;
    budget.record(caller.accountId, resource, { limit, remaining, resetAt: reset * 1000, cost });
  };

  const send = (url: string, init: RequestInit) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, { ...init, signal });

        return { response, text: await response.text() };
      },
      catch: (cause) => new GitHubRequestError({ status: 0, message: String(cause) }),
    });

  const failure = (caller: Caller, response: Response, text: string): GitHubCallError => {
    const { status } = response;
    const message = messageOf(text, `GitHub answered ${status}`);
    const retryAfter = headerInt(response.headers, "retry-after");
    const reset = headerInt(response.headers, "x-ratelimit-reset");

    if (status === 401) return new GitHubAuthError({ accountId: caller.accountId, message });

    if (status === 404) return new GitHubNotFound({ message });

    if ((status === 403 || status === 429) && retryAfter !== null) {
      return new GitHubRateLimited({ resetAt: now() + retryAfter * 1000, message });
    }

    if (
      (status === 403 || status === 429) &&
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      return new GitHubRateLimited({ resetAt: (reset ?? 60) * 1000, message });
    }

    if (status === 403) return new GitHubForbidden({ message });

    return new GitHubRequestError({ status, message });
  };

  const decode = <S extends Schema.Top>(schema: S, text: string, status: number) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
      Effect.mapError(
        (error) =>
          new GitHubRequestError({ status, message: `unexpected response: ${error.message}` })
      )
    );

  /** A REST call; a GET with an ETag may come back not modified. */
  const rest = <S extends Schema.Top & { readonly DecodingServices: never }>(
    caller: Caller,
    schema: S,
    request: RestRequest
  ) =>
    Effect.gen(function* () {
      const init: RequestInit = { method: request.method, headers: headers(caller) };

      if (request.etag !== null)
        init.headers = withHeader(headers(caller), "if-none-match", request.etag);

      if (request.body !== null) init.body = JSON.stringify(request.body);

      const { response, text } = yield* send(`${caller.endpoints.api}${request.path}`, init);

      record(caller, response, "core", response.status === 304 ? 0 : 1);

      if (response.status === 304) return { status: "not-modified" } as const;

      if (!response.ok) return yield* Effect.fail(failure(caller, response, text));

      const value: S["Type"] = yield* decode(schema, text === "" ? "null" : text, response.status);

      return { status: "ok", etag: response.headers.get("etag"), value } as const;
    });

  const graphqlFailure = (errors: ReadonlyArray<typeof GraphQLError.Type>, caller: Caller) => {
    const first = errors[0];
    const message = errors.map((e) => e.message).join("; ");

    if (first?.type === "NOT_FOUND") return new GitHubNotFound({ message });

    if (first?.type === "FORBIDDEN") return new GitHubForbidden({ message });

    if (first?.type === "RATE_LIMITED") {
      const window = budget.window(caller.accountId, "graphql");

      return new GitHubRateLimited({ resetAt: window?.resetAt ?? now() + 60_000, message });
    }

    return new GitHubRequestError({ status: 200, message });
  };

  /** A GraphQL query or mutation; any error in the body fails it (GitHub answers 200). */
  const graphql = <S extends Schema.Top & { readonly DecodingServices: never }>(
    caller: Caller,
    schema: S,
    request: GraphQLRequest
  ) =>
    Effect.gen(function* () {
      const { response, text } = yield* send(caller.endpoints.graphql, {
        method: "POST",
        headers: headers(caller),
        body: JSON.stringify(request),
      });

      record(caller, response, "graphql", 1);

      if (!response.ok) return yield* Effect.fail(failure(caller, response, text));

      const envelope = yield* decode(
        Schema.Struct({
          data: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
          errors: Schema.optionalKey(Schema.Array(GraphQLError)),
        }),
        text,
        200
      );

      if (envelope.errors !== undefined && envelope.errors.length > 0) {
        return yield* Effect.fail(graphqlFailure(envelope.errors, caller));
      }

      const data: S["Type"] = yield* Schema.decodeUnknownEffect(schema)(envelope.data).pipe(
        Effect.mapError(
          (error) =>
            new GitHubRequestError({ status: 200, message: `unexpected data: ${error.message}` })
        )
      );

      return data;
    });

  /** The OAuth endpoints on the web host (device code, token, refresh): form in, JSON out. */
  const oauth = <S extends Schema.Top & { readonly DecodingServices: never }>(
    endpoints: GitHubEndpoints,
    path: string,
    schema: S,
    form: Readonly<Record<string, string>>
  ) =>
    Effect.gen(function* () {
      const { response, text } = yield* send(`${endpoints.web}${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Polaris",
        },
        body: new URLSearchParams(form).toString(),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          new GitHubRequestError({
            status: response.status,
            message: messageOf(text, "OAuth failed"),
          })
        );
      }

      const value: S["Type"] = yield* decode(schema, text, response.status);

      return value;
    });

  return { rest, graphql, oauth, budget };
};

export type Transport = ReturnType<typeof newTransport>;
