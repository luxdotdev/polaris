import { expect, test } from "bun:test";
import type { PredictionServerRequest } from "@polaris/protocol";
import { identifyServer, runServerAction } from "./server.ts";

interface Call {
  readonly method: string;
  readonly url: string;
  /** The JSON body as sent; null for a GET. */
  readonly body: string | null;
}

type Route = () => Response;

/** A fake server: each "METHOD path" answers; anything else is a 404. */
const server = (routes: Record<string, Route>, calls: Call[] = []) => {
  const fetcher = async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({
      method,
      url,
      body: init.body == null ? null : await new Response(init.body).text(),
    });
    const path = new URL(url).pathname + new URL(url).search;
    const route = routes[`${method} ${path}`];

    return route === undefined ? new Response("not found", { status: 404 }) : route();
  };

  return { fetcher, calls };
};

const bodies = (calls: ReadonlyArray<Call>) =>
  calls.flatMap((call) => {
    if (call.body === null) return [];
    const parsed: unknown = JSON.parse(call.body);

    return [parsed];
  });

/** The rejection itself, to match against. */
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error) => error
  );

const openai = { kind: "openai", url: "http://127.0.0.1:8080/v1" } as const;

const MODEL = "mellum2-12b-a2.5b";

const request = (
  action: PredictionServerRequest["action"],
  endpoint: PredictionServerRequest["endpoint"] = openai
) => ({
  endpoint,
  model: MODEL,
  action,
});

const llama = (slots: boolean, erase: Route = () => Response.json({ n_erased: 12 })) => {
  const routes = {
    "GET /props": () => Response.json({ default_generation_settings: { n_ctx: 8192 } }),
    "POST /slots/0?action=erase": erase,
    "POST /slots/1?action=erase": erase,
  };

  return slots ? { ...routes, "GET /slots": () => Response.json([{ id: 0 }, { id: 1 }]) } : routes;
};

const LM_MODELS = {
  models: [
    {
      key: "jetbrains/mellum2",
      loaded_instances: [{ id: MODEL, config: { context_length: 8192, flash_attention: true } }],
    },
  ],
};

test("llama-server offers to clear its prompt cache only when its slots API answers", async () => {
  expect(await identifyServer(openai, MODEL, server(llama(true)).fetcher)).toEqual({
    kind: "llama-server",
    actions: ["clear-cache"],
    outcome: null,
  });
  expect((await identifyServer(openai, MODEL, server(llama(false)).fetcher)).actions).toEqual([]);
});

test("Clearing the cache erases every slot, and a refusal keeps llama-server's words", async () => {
  const { fetcher, calls } = server(llama(true));
  const done = await runServerAction(request("clear-cache"), fetcher);
  expect(done.outcome).toBe("Cleared the prompt cache in 2 slots");
  expect(calls.filter((c) => c.method === "POST").map((c) => new URL(c.url).pathname)).toEqual([
    "/slots/0",
    "/slots/1",
  ]);

  const refused = server(
    llama(true, () =>
      Response.json(
        {
          error: {
            message: "This server does not support slots action. Start it with `--slot-save-path`",
          },
        },
        { status: 501 }
      )
    )
  );

  expect(await rejection(runServerAction(request("clear-cache"), refused.fetcher))).toMatchObject({
    message: "This server does not support slots action. Start it with `--slot-save-path`",
  });
});

test("Ollama reloads the model: unload with keep_alive 0, then load it", async () => {
  const { fetcher, calls } = server({
    "POST /api/generate": () => Response.json({ done: true }),
  });

  const ollama = { kind: "ollama", url: "http://127.0.0.1:11434" } as const;
  expect(await identifyServer(ollama, MODEL, fetcher)).toMatchObject({ kind: "ollama" });
  const done = await runServerAction(request("reload-model", ollama), fetcher);
  expect(done.outcome).toBe(`Reloaded ${MODEL}`);
  expect(bodies(calls)).toEqual([
    { model: MODEL, keep_alive: 0 },
    { model: MODEL, stream: false },
  ]);
});

test("LM Studio reloads the loaded instance with the config it had", async () => {
  const { fetcher, calls } = server({
    "GET /api/v1/models": () => Response.json(LM_MODELS),
    "POST /api/v1/models/unload": () => Response.json({ instance_id: MODEL }),
    "POST /api/v1/models/load": () => Response.json({}),
  });

  const lmStudio = { kind: "openai", url: "http://127.0.0.1:1234" } as const;
  expect(await identifyServer(lmStudio, MODEL, fetcher)).toEqual({
    kind: "lm-studio",
    actions: ["reload-model"],
    outcome: null,
  });
  await runServerAction(request("reload-model", lmStudio), fetcher);
  expect(bodies(calls)).toEqual([
    { instance_id: MODEL },
    { model: "jetbrains/mellum2", context_length: 8192, flash_attention: true },
  ]);
  expect((await identifyServer(lmStudio, "other-model", fetcher)).actions).toEqual([]);
});

test("An unrecognised server offers nothing, and nothing runs that it didn't offer", async () => {
  const { fetcher, calls } = server({ "GET /v1/models": () => Response.json({ data: [] }) });
  expect(await identifyServer(openai, MODEL, fetcher)).toEqual({
    kind: "unknown",
    actions: [],
    outcome: null,
  });
  expect(await rejection(runServerAction(request("clear-cache"), fetcher))).toMatchObject({
    reason: "unavailable",
  });
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("Only private addresses are reached", async () => {
  const { fetcher, calls } = server({});
  const outside = { kind: "openai", url: "http://93.184.216.34:8080" } as const;
  expect(await rejection(identifyServer(outside, MODEL, fetcher))).toMatchObject({
    reason: "invalid-request",
  });
  expect(calls).toEqual([]);
});
