/**
 * One wide event per request (canonical log line): handlers add fields to `event`,
 * `withWideEvent` adds timing, status and deployment context and emits it once.
 * Events never carry an email address, IP, request body, header dump or error message.
 */
import { after } from "next/server";
import { Function, Option, Schema } from "effect";

/** An error reduced to its type and, for AWS SDK errors, its HTTP status. */
export type ErrorInfo = { readonly type: string; readonly http_status?: number };

export type Field = string | number | boolean | null | readonly string[] | ErrorInfo;

export type WideEvent = Record<string, Field>;

export type Level = "info" | "error";

export type LogEnv = Readonly<Record<string, string | undefined>>;

export type Emit = (event: WideEvent, level: Level, env: LogEnv) => Promise<void>;

const errorName = /^[\w.:-]{1,64}$/;

const Metadata = Schema.Struct({
  $metadata: Schema.Struct({ httpStatusCode: Schema.optional(Schema.Number) }),
});

const decodeMetadata = Schema.decodeUnknownOption(Metadata);

const unknownError: ErrorInfo = { type: "unknown" };

function describe(error: Error): ErrorInfo {
  const type = errorName.test(error.name) ? error.name : "Error";
  const httpStatus = Option.getOrUndefined(decodeMetadata(error))?.$metadata.httpStatusCode;

  return httpStatus === undefined ? { type } : { type, http_status: httpStatus };
}

/** The caught value's error type and HTTP status; never its message. */
export const errorInfo = Function.flow(
  Schema.decodeUnknownOption(Schema.instanceOf(Error)),
  Option.match({ onNone: () => unknownError, onSome: describe })
);

export function deployment(env: LogEnv) {
  return {
    service: "polaris-site",
    commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    deployment_id: env.VERCEL_DEPLOYMENT_ID ?? null,
    environment: env.VERCEL_ENV ?? env.NODE_ENV ?? null,
    region: env.VERCEL_REGION ?? null,
  };
}

const decodeIngest = Schema.decodeUnknownSync(
  Schema.Struct({ ingested: Schema.Number, failed: Schema.Number })
);

/** The slice of `fetch` the logger uses; `fetch` itself satisfies it. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

async function ship(event: WideEvent, env: LogEnv, fetcher: Fetcher): Promise<string> {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) return "unconfigured";

  if (env.NODE_ENV !== "production") return "skipped";

  try {
    const response = await fetcher(
      `https://api.axiom.co/v1/ingest/${encodeURIComponent(env.AXIOM_DATASET)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.AXIOM_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify([event]),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      }
    );

    if (!response.ok) return `rejected_${response.status}`;
    const receipt = decodeIngest(await response.json());

    return receipt.ingested === 1 && receipt.failed === 0 ? "ok" : "rejected_receipt";
  } catch (error) {
    return `failed_${errorInfo(error).type}`;
  }
}

function write(level: Level, event: WideEvent) {
  const line = JSON.stringify(event);

  if (level === "error") console.error(line);
  else console.log(line);
}

/** Sends the event to Axiom, then writes it as one JSON line with the ingest result. */
export function createEmit(
  fetcher: Fetcher = fetch,
  out: (level: Level, event: WideEvent) => void = write
): Emit {
  return async (event, level, env) => {
    const axiom = await ship(event, env, fetcher);
    out(level, { ...event, axiom });
  };
}

export const emit = createEmit();

type Options = {
  env: LogEnv;
  schedule: (task: () => Promise<void>) => void;
  emit: Emit;
  now: () => number;
};

const defaults = (): Options => ({ env: process.env, schedule: after, emit, now: Date.now });

function startEvent(request: Request, route: string, env: LogEnv, started: number): WideEvent {
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- a wide event is open by design: handlers add fields after it starts.
  return {
    _time: new Date(started).toISOString(),
    request_id: request.headers.get("x-vercel-id") ?? crypto.randomUUID(),
    method: request.method,
    route,
    ...deployment(env),
  };
}

/** Wraps a route handler so it emits exactly one wide event per request. */
export function withWideEvent<C>(
  route: string,
  handler: (request: Request, event: WideEvent, context: C) => Promise<Response>,
  overrides: Partial<Options> = {}
) {
  return async (request: Request, context: C): Promise<Response> => {
    const options = { ...defaults(), ...overrides };
    const started = options.now();
    const event = startEvent(request, route, options.env, started);

    let level: Level = "info";

    try {
      const response = await handler(request, event, context);
      event.status_code = response.status;

      if (response.status >= 500) {
        event.outcome = "error";
        level = "error";
      } else event.outcome = response.status >= 400 ? "rejected" : "success";

      return response;
    } catch (error) {
      event.status_code = 500;
      event.outcome = "error";
      event.error = errorInfo(error);
      level = "error";
      throw error;
    } finally {
      event.duration_ms = options.now() - started;
      options.schedule(() => options.emit(event, level, options.env));
    }
  };
}
