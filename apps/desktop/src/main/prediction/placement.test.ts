import { LatencyRecorder } from "@polaris/predict";
import { expect, test } from "bun:test";
import type { PredictionCapability } from "@polaris/protocol";
import { DEFAULT_PREDICTION_PREFERENCES } from "../../shared/predictionPlacement.ts";
import type { Settings } from "../settings.ts";
import { PredictionSettings } from "./preferences.ts";
import { MainPredictionPlacement } from "./placement.ts";

const report: PredictionCapability = {
  machine: {
    chip: "Apple M2 Max",
    cpuCores: 12,
    ramBytes: 32 * 1024 ** 3,
    gpu: "Apple Silicon",
    gpuMemoryBytes: 32 * 1024 ** 3,
    unifiedMemory: true,
    load: 7,
  },
  endpoints: [{ kind: "openai", url: "http://127.0.0.1:8080", models: ["mellum2-12b-a2.5b"] }],
};

test("Main probes both sides, uses measured p50, and isolates Workspace failure", async () => {
  const preferences = new PredictionSettings(
    () => ({}),
    () => {}
  );

  const main = new MainPredictionPlacement({
    client: async () => report,
    host: async () => report,
    preferences,
    latency: (side) => (side === "host" ? 20 : 100),
  });

  const signal = new AbortController().signal;
  expect((await main.choose("mac", "one", signal)).context.serving?.side).toBe("host");

  const chosen = await main.run(
    "mac",
    "one",
    async (target) => {
      if (target.side === "host") throw new Error("endpoint failed");

      return target.side;
    },
    signal
  );

  expect(chosen).toBe("client");
  expect((await main.choose("mac", "two", signal)).context.serving?.side).toBe("host");
  main.release("mac", "one");
});

test("Off performs no probes and an old Daemon falls back locally", async () => {
  let settings: Settings = {
    prediction: { mac: { ...DEFAULT_PREDICTION_PREFERENCES, placement: "off" } },
  };

  const preferences = new PredictionSettings(
    () => settings,
    (value) => {
      settings = value;
    }
  );

  let probes = 0;

  const main = new MainPredictionPlacement({
    client: async () => {
      probes++;

      return report;
    },
    host: async () => {
      throw new Error("no capability");
    },
    preferences,
  });

  const signal = new AbortController().signal;
  expect((await main.choose("mac", "one", signal)).value).toBe("off");
  expect(probes).toBe(0);
  preferences.set("mac", DEFAULT_PREDICTION_PREFERENCES);
  expect((await main.choose("mac", "one", signal)).context.serving?.side).toBe("client");
});

test("Request replacement and settings invalidation abort the serving request", async () => {
  const preferences = new PredictionSettings(
    () => ({}),
    () => {}
  );

  const main = new MainPredictionPlacement({
    client: async () => report,
    host: async () => null,
    preferences,
  });

  let started: () => void = () => {};

  const serving = new Promise<void>((resolve) => {
    started = resolve;
  });

  let aborted = false;

  const first = main
    .run(
      "mac",
      "one",
      async (_target, signal) => {
        started();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("cancelled"));
            },
            { once: true }
          )
        );

        return "old";
      },
      new AbortController().signal
    )
    .then(
      () => false,
      () => true
    );

  await serving;
  expect(await main.run("mac", "one", async () => "new", new AbortController().signal)).toBe("new");
  expect(await first).toBe(true);
  expect(aborted).toBe(true);

  let ready: () => void = () => {};

  const active = new Promise<void>((resolve) => {
    ready = resolve;
  });

  const pending = main
    .run(
      "mac",
      "one",
      async (_target, signal) => {
        ready();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("settings changed")), {
            once: true,
          })
        );
      },
      new AbortController().signal
    )
    .then(
      () => false,
      () => true
    );

  await active;
  main.invalidateHost("mac");
  expect(await pending).toBe(true);
});

test("Successful Host requests record round-trip latency in the shared recorder", async () => {
  const recorders: LatencyRecorder[] = [];

  const preferences = new PredictionSettings(
    () => ({ prediction: { mac: { ...DEFAULT_PREDICTION_PREFERENCES, placement: "host" } } }),
    () => {}
  );

  const main = new MainPredictionPlacement({
    client: async () => report,
    host: async () => report,
    preferences,
    recorder: () => {
      const recorder = new LatencyRecorder();
      recorders.push(recorder);

      return recorder;
    },
  });

  expect(await main.run("mac", "one", async () => "final", new AbortController().signal)).toBe(
    "final"
  );
  expect(recorders.length).toBe(2);
  expect(recorders[1]?.p50(report.endpoints[0]!)).not.toBeNull();
  expect(recorders[0]?.p50(report.endpoints[0]!)).toBeNull();
});
