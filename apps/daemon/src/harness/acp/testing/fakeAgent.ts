/**
 * A scriptable ACP agent for tests, run as its own process on stdio like a real
 * Harness. `FAKE_ACP_SCENARIO` names a JSON `Scenario`; every message it
 * receives is appended to `FAKE_ACP_LOG` as one JSON line.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { Option, Predicate, Schema } from "effect";

const Json = Schema.Record(Schema.String, Schema.Unknown);

const Step = Schema.Union([
  /** Sends `session/update` with this update. */
  Schema.Struct({ update: Json }),
  /** Sends `session/request_permission` and waits for the answer. */
  Schema.Struct({
    permission: Schema.Struct({ toolCall: Json, options: Schema.Array(Json) }),
  }),
  /** Waits for `session/cancel`, then ends the Turn `cancelled`. */
  Schema.Struct({ waitForCancel: Schema.Literal(true) }),
  /** Exits the process. */
  Schema.Struct({ exit: Schema.Int }),
]);

export const Scenario = Schema.Struct({
  initialize: Schema.optional(Json),
  /** A JSON-RPC error `session/new` answers with (e.g. auth required). */
  newSessionError: Schema.optional(Schema.Struct({ code: Schema.Int, message: Schema.String })),
  sessionId: Schema.optional(Schema.String),
  /** `modes` and `configOptions` the session starts with. */
  setup: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(Json),
      configOptions: Schema.optional(Schema.Array(Json)),
    })
  ),
  /** Updates `session/load` replays before it answers. */
  replay: Schema.optional(Schema.Array(Json)),
  /** One script per `session/prompt`, in order; the last one repeats. */
  prompts: Schema.optional(
    Schema.Array(
      Schema.Struct({ steps: Schema.Array(Step), stopReason: Schema.optional(Schema.String) })
    )
  ),
});

export type Scenario = typeof Scenario.Encoded;

type Step = typeof Step.Type;

const Received = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Json),
  result: Schema.optional(Schema.Unknown),
});

type Received = typeof Received.Type;

/** A message the fake agent writes. */
interface Outgoing {
  readonly id?: string | number | undefined;
  readonly method?: string;
  readonly params?: typeof Json.Type;
  readonly result?: typeof Json.Type;
  readonly error?: { readonly code: number; readonly message: string };
}

const scenario = Schema.decodeUnknownSync(Schema.fromJsonString(Scenario))(
  readFileSync(process.env.FAKE_ACP_SCENARIO ?? "", "utf8")
);

const decodeReceived = Schema.decodeUnknownOption(Schema.fromJsonString(Received));

const log = process.env.FAKE_ACP_LOG;

/** The session the agent serves: its own, or the one a client resumed. */
let sessionId = scenario.sessionId ?? "fake-session";

const adopt = (message: Received) => {
  const resumed = message.params?.sessionId;

  if (Predicate.isString(resumed)) sessionId = resumed;
};

const send = (message: Outgoing) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
};

let nextId = 1000;

const waiting = new Map<string | number, () => void>();

let cancelled: (() => void) | null = null;

let prompts = 0;

const request = (method: string, params: typeof Json.Type) =>
  new Promise<void>((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });

const update = (value: typeof Json.Type) =>
  send({ method: "session/update", params: { sessionId, update: value } });

const waitForCancel = () =>
  new Promise<string>((resolve) => {
    cancelled = () => resolve("cancelled");
  });

/** Runs one step; a stop reason ends the Turn early. */
const runStep = async (step: Step): Promise<string | null> => {
  if ("update" in step) update(step.update);
  else if ("permission" in step)
    await request("session/request_permission", { sessionId, ...step.permission });
  else if ("waitForCancel" in step) return waitForCancel();
  else process.exit(step.exit);

  return null;
};

const prompt = async (id: string | number | undefined) => {
  const scripts = scenario.prompts ?? [];
  const script = scripts[Math.min(prompts++, scripts.length - 1)];

  for (const step of script?.steps ?? []) {
    const stop = await runStep(step);

    if (stop !== null) return send({ id, result: { stopReason: stop } });
  }

  send({ id, result: { stopReason: script?.stopReason ?? "end_turn" } });
};

const setConfigOption = (message: Received) => {
  const configOptions = (scenario.setup?.configOptions ?? []).map((option) =>
    option.id === message.params?.configId
      ? { ...option, currentValue: message.params?.value }
      : option
  );

  send({ id: message.id, result: { configOptions } });
};

const handlers = {
  initialize: (m) =>
    send({
      id: m.id,
      result: scenario.initialize ?? { protocolVersion: 1, agentCapabilities: {} },
    }),
  "session/new": (m) =>
    scenario.newSessionError
      ? send({ id: m.id, error: scenario.newSessionError })
      : send({ id: m.id, result: { sessionId, ...scenario.setup } }),
  "session/load": (m) => {
    adopt(m);

    for (const value of scenario.replay ?? []) update(value);

    send({ id: m.id, result: { ...scenario.setup } });
  },
  "session/resume": (m) => {
    adopt(m);
    send({ id: m.id, result: { ...scenario.setup } });
  },
  "session/close": (m) => send({ id: m.id, result: {} }),
  "session/set_mode": (m) => send({ id: m.id, result: {} }),
  "session/set_config_option": setConfigOption,
  "session/prompt": (m) => void prompt(m.id),
  "session/cancel": () => cancelled?.(),
} satisfies Record<string, (message: Received) => void>;

const isHandled = (method: string): method is keyof typeof handlers => method in handlers;

const onMessage = (message: Received) => {
  if (message.method === undefined) {
    if (message.id !== undefined) waiting.get(message.id)?.();

    return;
  }

  if (isHandled(message.method)) handlers[message.method](message);
};

let buffer = "";

process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  let end = buffer.indexOf("\n");

  while (end >= 0) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    end = buffer.indexOf("\n");

    if (line === "") continue;

    if (log) appendFileSync(log, `${line}\n`);
    Option.map(decodeReceived(line), onMessage);
  }
});
