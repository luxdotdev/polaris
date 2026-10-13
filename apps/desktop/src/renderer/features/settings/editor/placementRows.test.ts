import { describe, expect, test } from "bun:test";
import type { PredictionInspection } from "../../../../shared/predictionContract.ts";
import { DEFAULT_PREDICTION_PREFERENCES } from "../../../../shared/predictionPlacement.ts";
import { memoryLine, placementRow, type PlacementRowInput } from "./placementRows.ts";

const GiB = 1024 ** 3;

const machine = (ramGiB: number, chip = "Apple M2 Max") => ({
  chip,
  cpuCores: 8,
  ramBytes: ramGiB * GiB,
  gpu: null,
  gpuMemoryBytes: null,
  unifiedMemory: true,
  load: null,
});

const server = (...models: ReadonlyArray<string>) => ({
  kind: "openai" as const,
  url: "http://127.0.0.1:8080",
  models,
});

const MELLUM = "mellum2-12b-a2.5b";

const QWEN = "qwen2.5-coder-1.5b";

const inspection = (
  host: PredictionInspection["host"],
  client: PredictionInspection["client"] = { machine: machine(64), endpoints: [server(MELLUM)] }
): PredictionInspection => ({
  clientLabel: "Mac Studio",
  hostLabel: "Linux VM",
  client,
  host,
  offer: false,
});

const input = (patch: Partial<PlacementRowInput> = {}): PlacementRowInput => ({
  host: { key: "vm", label: "Linux VM", state: "connected" },
  preferences: DEFAULT_PREDICTION_PREFERENCES,
  inspection: inspection({ machine: machine(16), endpoints: [] }),
  result: undefined,
  clientName: "Mac Studio",
  ...patch,
});

describe("placementRow", () => {
  test("names the machine placement would choose before any completion", () => {
    expect(placementRow(input()).caption).toBe("Served by Mac Studio · Mellum2");
  });

  test("a Pi is served by the Client, offers only the Client's models and can't be chosen", () => {
    const row = placementRow(
      input({
        host: { key: "pi", label: "Pi 4", state: "connected" },
        inspection: inspection({
          machine: machine(8, "Raspberry Pi 4 Model B"),
          endpoints: [server(QWEN)],
        }),
      })
    );

    expect(row.caption).toBe("Served by Mac Studio · Mellum2 · this host is too small to serve");
    expect(row.hostCanServe).toBe(false);
    expect(row.models).toEqual([MELLUM]);
  });

  test("the local Host's default name reads as running text", () => {
    expect(placementRow(input({ clientName: "This Mac" })).caption).toBe(
      "Served by this Mac · Mellum2"
    );
  });

  test("the last completion's machine wins when placement could pick it", () => {
    const row = placementRow(
      input({
        inspection: inspection({ machine: machine(32), endpoints: [server(MELLUM)] }),
        result: { machine: "Linux VM", model: MELLUM },
      })
    );

    expect(row.caption).toBe("Served by Linux VM · Mellum2");
  });

  test("states say why nothing serves", () => {
    expect(placementRow(input({ inspection: undefined })).caption).toBe("Finding model server…");
    expect(
      placementRow(input({ preferences: { ...DEFAULT_PREDICTION_PREFERENCES, placement: "off" } }))
        .caption
    ).toBe("Off for this host");
    expect(
      placementRow(input({ inspection: inspection(null, { machine: machine(64), endpoints: [] }) }))
        .caption
    ).toBe("No model server found");
    expect(
      placementRow(input({ host: { key: "vm", label: "Linux VM", state: "offline" } })).caption
    ).toBe("Offline");
  });

  test("a chosen model no machine has is kept and flagged", () => {
    const row = placementRow(
      input({ preferences: { ...DEFAULT_PREDICTION_PREFERENCES, model: "gone-7b" } })
    );

    expect(row.modelMissing).toBe(true);
    expect(row.caption).toBe("gone-7b isn't on a model server it can use");
  });
});

describe("memoryLine", () => {
  test("says no model server runs instead of 0 GB", () => {
    expect(memoryLine({ rssBytes: 0, processes: 0 }, "This Mac")).toBe(
      "No model server running on this Mac"
    );
    expect(memoryLine(null, "This Mac")).toBeNull();
  });

  test("reports GB, or MB under a gigabyte", () => {
    expect(memoryLine({ rssBytes: 9.4 * GiB, processes: 1 }, "Mac Studio")).toBe(
      "Model server on Mac Studio · 9.4 GB of memory, counted apart from Polaris"
    );
    expect(memoryLine({ rssBytes: 300 * 1024 ** 2, processes: 2 }, "This Mac")).toBe(
      "2 model servers on this Mac · 300 MB of memory, counted apart from Polaris"
    );
  });
});
