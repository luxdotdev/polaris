/**
 * A scriptable stand-in for `opencode serve` v1: real HTTP and SSE on loopback,
 * basic auth, per-directory `/event` streams, and canned answers for the routes
 * the driver calls. Tests push events with `emit` and read what the driver sent
 * from `requests`.
 */
import { Effect } from "effect";
import type { Payload } from "../protocol.ts";
import type { OpenCodeServer } from "../Server.ts";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly directory: string | null;
  readonly body: Payload;
}

type Handler = (request: RecordedRequest) => Payload;

export interface FakeServer {
  readonly url: string;
  readonly password: string;
  readonly requests: Array<RecordedRequest>;
  /** Sends one event to every `/event` stream open for `directory`. */
  readonly emit: (directory: string, payload: Payload) => void;
  /** Ends every open `/event` stream, as a server that went away would. */
  readonly dropEvents: () => void;
  /** Overrides a route, e.g. `respond("GET /session/status", () => ({ ses_1: { type: "busy" } }))`. */
  readonly respond: (route: string, handler: Handler) => void;
  /** Resolves once a `/event` stream is open for `directory`. */
  readonly subscribed: (directory: string) => Promise<void>;
  /** The requests to a route so far (`"POST /session/ses_1/prompt_async"`). */
  readonly sent: (route: string) => ReadonlyArray<RecordedRequest>;
  /** An `OpenCodeServer` whose lease hands out this fake. */
  readonly asServer: (passwordFile?: string) => OpenCodeServer;
  readonly stop: () => void;
}

export const FAKE_SESSION_ID = "ses_fake1";

const session = (
  id: string,
  directory: string,
  title = "New session - 2026-09-29T05:00:00.000Z"
) => ({
  id,
  slug: "fake",
  projectID: "global",
  directory,
  title,
  version: "1.18.33",
  time: { created: 0, updated: 0 },
});

export const makeFakeServer = (options: { readonly sessionId?: string } = {}): FakeServer => {
  const password = "fake-password";
  const sessionId = options.sessionId ?? FAKE_SESSION_ID;
  const requests: Array<RecordedRequest> = [];
  const streams = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
  const waiters: Array<{ directory: string; resolve: () => void }> = [];
  const encoder = new TextEncoder();

  const routes = new Map<string, Handler>([
    ["POST /session", (r) => session(sessionId, r.directory ?? "/")],
    [`GET /session/${sessionId}`, (r) => session(sessionId, r.directory ?? "/")],
    [`PATCH /session/${sessionId}`, (r) => session(sessionId, r.directory ?? "/")],
    [`POST /session/${sessionId}/prompt_async`, () => null],
    [`POST /session/${sessionId}/abort`, () => true],
    ["GET /session/status", () => ({})],
    ["GET /permission", () => []],
    ["GET /question", () => []],
    ["GET /config", () => ({})],
    ["GET /config/providers", () => ({ providers: [], default: {} })],
  ]);

  const send = (controller: ReadableStreamDefaultController<Uint8Array>, payload: Payload) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  const eventStream = (directory: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          streams.set(controller, directory);
          send(controller, { type: "server.connected", properties: {} });

          for (const waiter of waiters.splice(0))
            if (waiter.directory === directory) waiter.resolve();
            else waiters.push(waiter);
        },
        cancel: () => {
          for (const [controller, dir] of streams)
            if (dir === directory) streams.delete(controller);
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    );

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: async (req) => {
      if (req.headers.get("authorization") !== `Basic ${btoa(`opencode:${password}`)}`)
        return new Response("unauthorized", { status: 401 });
      const url = new URL(req.url);
      const header = req.headers.get("x-opencode-directory");
      const directory = header === null ? null : decodeURIComponent(header);

      if (url.pathname === "/event") return eventStream(directory ?? "/");
      const text = await req.text();

      const body: Payload = text ? JSON.parse(text) : undefined;

      const recorded = {
        method: req.method,
        path: url.pathname,
        directory,
        body,
      };

      requests.push(recorded);
      const route = `${req.method} ${url.pathname}`;

      const handler =
        routes.get(route) ??
        (/^POST \/(permission|question)\/[^/]+\/(reply|reject)$/.test(route)
          ? () => true
          : undefined);

      if (handler === undefined) return new Response(`no fake route for ${route}`, { status: 404 });
      const result = handler(recorded);

      if (result instanceof Response) return result;

      return result === null ? new Response(null, { status: 204 }) : Response.json(result);
    },
  });

  const url = `http://127.0.0.1:${server.port}`;

  return {
    url,
    password,
    requests,
    emit: (directory, payload) => {
      for (const [controller, dir] of streams) if (dir === directory) send(controller, payload);
    },
    dropEvents: () => {
      for (const controller of streams.keys()) controller.close();
      streams.clear();
    },
    respond: (route, handler) => {
      routes.set(route, handler);
    },
    subscribed: (directory) =>
      [...streams.values()].includes(directory)
        ? Promise.resolve()
        : new Promise((resolve) => waiters.push({ directory, resolve })),
    sent: (route) => requests.filter((r) => `${r.method} ${r.path}` === route),
    asServer: (passwordFile = "/nonexistent/opencode-server.password") => ({
      lease: Effect.succeed({ url, password, opencodePath: "/usr/local/bin/opencode" }),
      passwordFile,
      running: Effect.succeed(true),
    }),
    stop: () => {
      for (const controller of streams.keys()) controller.close();
      streams.clear();
      void server.stop(true);
    },
  };
};
