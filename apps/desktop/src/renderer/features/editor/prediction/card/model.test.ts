import { expect, test } from "bun:test";
import { DEFAULT_PREDICTION_PREFERENCES } from "../../../../../shared/predictionPlacement.ts";
import { BASE, EMPTY, INSPECTION, SCENES, SERVED } from "./fixtures.ts";
import { completionCard, type CardInput } from "./model.ts";

const card = (patch: Partial<CardInput> = {}) => completionCard({ ...BASE, ...patch });

const fact = (view: ReturnType<typeof card>, label: string) =>
  view.facts.find((item) => item.label === label);

const ids = (view: ReturnType<typeof card>) => view.actions.map((action) => action.id);

test("Every fixture scene reaches its own state, with Settings always last", () => {
  for (const [scene, input] of SCENES) {
    const view = completionCard(input);
    const expected = { "serving-ollama": "serving", "unknown-server": "ready" }[scene] ?? scene;

    expect<string>(view.kind).toBe(expected);
    expect(view.actions.at(-1)?.id).toBe("settings");
  }
});

test("Connection State comes before settings, and the status label keeps its three words", () => {
  expect(card({ connection: "offline", enabled: false }).kind).toBe("offline");
  expect(card({ connection: "needs-attention" }).title).toBe("Pi 4 is offline");
  expect(card({ connection: "reconnecting" }).label).toBe("Completions unavailable");
  expect(card({ enabled: false }).label).toBe("Completions off");
  expect(card({ result: SERVED }).label).toBe("Completions");
  expect(card({ hostName: "this Mac", connection: "offline" }).title).toBe("This Mac is offline");
});

test("Serving names the model, machine, placement reason, endpoint, latency and context", () => {
  const view = card({ result: SERVED });
  expect(view.kind).toBe("serving");
  expect(view.why).toBe("Completing with Mellum2 on this Mac.");
  expect(fact(view, "Runs on")).toMatchObject({
    value: "This Mac",
    note: "auto · host too small",
  });
  expect(fact(view, "Endpoint")).toMatchObject({ value: "127.0.0.1:8080", note: "llama-server" });
  expect(fact(view, "Latency")).toMatchObject({
    value: "438 ms",
    note: "p50 of 12 · last 412 ms",
  });
  expect(fact(view, "Context")).toMatchObject({
    value: "~1.2k tokens",
    note: "2 language-server pieces",
  });
  expect(view.memory).toContain("9.4 GB");
});

test("Before trust, context says the language server waits; a stale result shows no latency", () => {
  const view = card({ trusted: false, result: { ...SERVED, model: "something-else" } });
  expect(view.kind).toBe("ready");
  expect(fact(view, "Latency")).toBeUndefined();
  expect(fact(view, "Context")).toMatchObject({ value: "Nearby code only" });
  expect(card({ trusted: null }).facts.some((f) => f.label === "Context")).toBe(false);
  expect(fact(card({ result: { ...SERVED, context: null } }), "Context")?.value).toBe("None");
});

test("A failure keeps the server's words without the IPC's framing", () => {
  const view = card({ result: SERVED, failure: "PredictionError: model is loading" });
  expect(view.kind).toBe("failed");
  expect(view.failure).toBe("model is loading");
  expect(card({ result: SERVED, failure: "" }).kind).toBe("serving");
});

test("Placement notes say an override or why Auto chose this side", () => {
  const set = { ...DEFAULT_PREDICTION_PREFERENCES, placement: "client" as const };
  expect(fact(card({ preferences: set }), "Runs on")?.note).toBe("set to this machine");

  const studio = { machine: { ...INSPECTION.client.machine, ramBytes: 8 * 1024 ** 3 } };
  const host = { ...studio, endpoints: [] };
  expect(fact(card({ inspection: { ...INSPECTION, host } }), "Runs on")?.note).toBe(
    "auto · the only model server"
  );
});

test("Models list Recommended first; ones Polaris can't prompt are disabled with the reason", () => {
  const view = card();
  expect(view.models?.map((m) => [m.id, m.enabled])).toEqual([
    [null, true],
    ["mellum2-12b-a2.5b-q4_k_m", true],
    ["qwen2.5-coder-1.5b", true],
    ["qwen3-coder-30b-a3b", false],
  ]);
  expect(view.models?.[0]?.note).toBe("Mellum2");
  expect(view.models?.[3]?.note).toBe("can't prompt yet");

  // Chosen with a prompt format in Settings, it is promptable after all.
  const chosen = { ...DEFAULT_PREDICTION_PREFERENCES, model: "qwen3-coder-30b-a3b" };
  expect(card({ preferences: { ...chosen, format: "qwen-fim" } }).models?.at(-1)?.enabled).toBe(
    true
  );

  const one = { ...INSPECTION.client, endpoints: [INSPECTION.client.endpoints[0]!] };
  const single = { ...one, endpoints: [{ ...one.endpoints[0]!, models: ["qwen2.5-coder-1.5b"] }] };
  expect(card({ inspection: { ...INSPECTION, client: single } }).models).toBeNull();
});

test("Recovery follows the server: clear the cache, reload a model, or advise a restart", () => {
  expect(ids(card())).toEqual(["check-again", "clear-cache", "turn-off-host", "settings"]);

  const ollama = card({ server: { kind: "ollama", actions: ["reload-model"], outcome: null } });
  expect(ollama.actions.find((a) => a.id === "reload-model")?.label).toBe("Reload Mellum2");
  expect(ollama.advice).toBeNull();

  const lmStudio = card({ server: { kind: "lm-studio", actions: [], outcome: null } });
  expect(ids(lmStudio)).toEqual(["check-again", "turn-off-host", "settings"]);
  expect(lmStudio.advice).toBe("If it stops answering, restart LM Studio on this Mac.");

  const unknown = card({ server: { kind: "unknown", actions: [], outcome: null } });
  expect(unknown.advice).toBe("If it stops answering, restart the model server on this Mac.");
  expect(fact(unknown, "Endpoint")?.note).toBe("OpenAI-compatible");
  expect(card({ server: null }).advice).toBeNull();
});

test("States that aren't working offer only what fits", () => {
  expect(ids(card({ enabled: false }))).toEqual(["turn-on", "settings"]);
  expect(ids(card({ enabled: false, offer: true }))).toEqual(["turn-on", "settings"]);
  const off = { ...DEFAULT_PREDICTION_PREFERENCES, placement: "off" as const };
  expect(card({ preferences: off }).actions[0]?.label).toBe("Turn on for Pi 4");
  expect(ids(card({ inspection: EMPTY }))).toEqual(["check-again", "settings"]);
  expect(ids(card({ connection: "offline" }))).toEqual(["settings"]);
  expect(card({ inspection: undefined }).facts).toEqual([]);
});

test("No model server suggests only machines that could serve", () => {
  expect(card({ inspection: EMPTY }).why).toBe(
    "Run llama-server, LM Studio or Ollama on this Mac, then check again."
  );
  const big = { ...EMPTY, host: { ...INSPECTION.client, endpoints: [] } };
  expect(card({ inspection: big, hostName: "Mac Studio" }).why).toContain(
    "on this Mac or Mac Studio"
  );
  expect(card({ inspection: undefined }).why).toBe(
    "Checking this Mac and Pi 4 for llama-server, LM Studio or Ollama."
  );
});
