/**
 * A fake of GitHub's OAuth, REST and GraphQL for tests and the smoke: no real
 * network, no real accounts. Use `fake.fetch` in-process, or `fake.serve()` and
 * point the app at it with `POLARIS_GITHUB_WEB_URL` / `POLARIS_GITHUB_API_URL`.
 * See README.md for the world it starts from and what it answers.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Option, Predicate, Schema } from "effect";
import { newAuth } from "./auth.ts";
import { errorResponse, GraphQLFailure, QUERIES } from "./graphql.ts";
import { type FakeRequest, type FakeResponse, json } from "./http.ts";
import { MUTATIONS } from "./mutations.ts";
import { rest } from "./rest.ts";
import { type Fixture, type FakeUser, type World, loadFixture, worldFrom } from "./world.ts";
import { seedOverview } from "./overview.ts";
import { newControl } from "./control.ts";

export type { FakeRequest, FakeResponse } from "./http.ts";

export type { World } from "./world.ts";

export const FAKE_CLIENT_ID = "Ov23lix8h2ldBZFwXqek";

/** The OAuth App an Enterprise admin registered on the fake GHE host. */
export const FAKE_GHE_CLIENT_ID = "0a1b2c3d4e5f6a7b8c9d";

export interface GitHubFakeOptions {
  /**
   * Serve as GitHub Enterprise Server: REST only under `/api/v3`, GraphQL at
   * `/api/graphql` (github.com's paths answer 404), OAuth at `/login/…`.
   */
  readonly enterprise?: boolean;
  readonly clientId?: string;
  /** The host's web URL, for `verification_uri`; github.com's by default. */
  readonly webUrl?: string;
  /** The fake's clock (ms): token expiry, device codes, rate windows. */
  readonly now?: () => number;
  /** Seconds between device-flow polls; GitHub says 5. */
  readonly interval?: number;
  readonly enforceInterval?: boolean;
  readonly fixture?: Fixture;
}

export interface LoggedRequest {
  readonly kind: "oauth" | "rest" | "graphql" | "control";
  /** The path, or the GraphQL operation's name. */
  readonly name: string;
  readonly status: number;
  readonly login: string | null;
}

const GraphQLBody = Schema.Struct({
  operationName: Schema.String,
  query: Schema.String,
});

const decodeGraphQL = Schema.decodeUnknownOption(Schema.fromJsonString(GraphQLBody));

const RESOLVERS = new Map([...QUERIES, ...MUTATIONS]);

export const createGitHubFake = (options: GitHubFakeOptions = {}) => {
  const now = options.now ?? Date.now;
  const world: World = worldFrom(options.fixture ?? loadFixture());

  const auth = newAuth(world, {
    now,
    interval: options.interval ?? 5,
    enforceInterval: options.enforceInterval ?? true,
    clientId: options.clientId ?? FAKE_CLIENT_ID,
    webUrl: options.webUrl ?? "https://github.com",
  });

  const requests: Array<LoggedRequest> = [];
  const failures: Array<FakeResponse> = [];
  const control = newControl({ world, auth, failures, now });

  const log = (entry: LoggedRequest, response: FakeResponse) => {
    requests.push(entry);

    return response;
  };

  const graphql = (request: FakeRequest, user: FakeUser) => {
    const body = Option.getOrNull(decodeGraphQL(request.body));
    const name = body?.operationName ?? "?";
    const { exhausted, headers } = auth.spend(user.login, "graphql", 1);

    const respond = (response: FakeResponse) =>
      log(
        { kind: "graphql", name, status: response.status, login: user.login },
        {
          ...response,
          headers: { ...response.headers, ...headers },
        }
      );

    const resolver = RESOLVERS.get(name);

    if (exhausted) {
      return respond(
        json(200, {
          data: null,
          errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
        })
      );
    }

    if (body === null || resolver === undefined) {
      return respond(json(200, { errors: [{ message: `the fake has no operation "${name}"` }] }));
    }

    try {
      return respond(json(200, { data: resolver(world, user, { body: request.body }) }));
    } catch (error) {
      if (error instanceof GraphQLFailure) return respond(errorResponse(error));
      throw error;
    }
  };

  const restCall = (request: FakeRequest, user: FakeUser) => {
    const response = rest({ world, user, request, now }) ?? json(404, { message: "Not Found" });
    const { exhausted, headers } = auth.spend(user.login, "core", response.status === 304 ? 0 : 1);

    const answered = exhausted
      ? json(403, { message: "API rate limit exceeded for user." }, headers)
      : { ...response, headers: { ...response.headers, ...headers } };

    return log(
      {
        kind: "rest",
        name: `${request.method} ${request.path}`,
        status: answered.status,
        login: user.login,
      },
      answered
    );
  };

  /** GHE's API paths mapped onto github.com's; null for a path GHE doesn't serve. */
  const enterprisePath = (path: string) => {
    if (path.startsWith("/login/") || path.startsWith("/_fake/")) return path;

    if (path === "/api/graphql") return "/graphql";

    if (path.startsWith("/api/v3/")) return path.slice("/api/v3".length);

    return null;
  };

  /** Answers one request, as GitHub (web and API hosts both, or a GHE host) would. */
  const handle = (incoming: FakeRequest): FakeResponse => {
    const path = options.enterprise === true ? enterprisePath(incoming.path) : incoming.path;

    if (path === null) {
      return log(
        { kind: "rest", name: incoming.path, status: 404, login: null },
        json(404, { message: "Not Found" })
      );
    }

    const request = { ...incoming, path };

    if (request.path.startsWith("/_fake/")) {
      return log(
        { kind: "control", name: request.path, status: 200, login: null },
        control.handle(request)
      );
    }

    const injected = failures.shift();

    if (injected !== undefined)
      return log(
        { kind: "rest", name: request.path, status: injected.status, login: null },
        injected
      );

    const oauth = auth.oauth(request);

    if (oauth !== null)
      return log({ kind: "oauth", name: request.path, status: oauth.status, login: null }, oauth);

    const user = auth.userOf(request);

    if (user === null) {
      return log(
        { kind: "rest", name: request.path, status: 401, login: null },
        json(401, { message: "Bad credentials" })
      );
    }

    if (request.method === "POST" && request.path === "/graphql") return graphql(request, user);

    return restCall(request, user);
  };

  /** A `fetch` that never leaves the process. */
  const fetch = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);

    const answer = handle({
      method: init.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init.headers),
      body: Predicate.isString(init.body) ? init.body : "",
    });

    return new Response(answer.status === 304 || answer.body === "" ? null : answer.body, {
      status: answer.status,
      headers: answer.headers,
    });
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Array<Buffer> = [];

      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const answer = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers))
      if (Predicate.isString(value)) headers.set(name, value);

    const response = handle({
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      headers,
      body: await readBody(req),
    });

    res.writeHead(response.status, response.headers);
    res.end(response.body);
  };

  /** Listens on 127.0.0.1 (any free port by default) for the smoke's Electron app. */
  const serve = (port = 0) =>
    new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
      const server = createServer((req, res) => void answer(req, res));

      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const bound = address === null || Predicate.isString(address) ? port : address.port;

        resolve({
          url: `http://127.0.0.1:${bound}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      });
    });

  return {
    world,
    requests,
    fetch,
    handle,
    serve,
    seedOverview: () => seedOverview(world),
    ...control.api,
  };
};

export type GitHubFake = ReturnType<typeof createGitHubFake>;

/** A GitHub Enterprise Server fake with its own world and OAuth App. */
export const createGitHubEnterpriseFake = (options: GitHubFakeOptions = {}) =>
  createGitHubFake({
    enterprise: true,
    clientId: FAKE_GHE_CLIENT_ID,
    webUrl: "https://ghe.acme.test",
    fixture: loadFixture("ghe"),
    ...options,
  });
