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
  managed: { client: null, host: null },
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

  test("Polaris's own next-edit server beats the user's FIM server on the same machine", () => {
    const managed = {
      kind: "openai" as const,
      url: "http://127.0.0.1:43210",
      models: ["sweep-next-edit-1.5b-q8_0"],
      managed: true,
    };

    const row = placementRow(
      input({
        inspection: inspection(
          { machine: machine(16), endpoints: [] },
          { machine: machine(64), endpoints: [server(MELLUM, QWEN), managed] }
        ),
      })
    );

    expect(row.caption).toBe("Served by Mac Studio · Sweep Next-Edit 1.5B");
  });

  test("a model Polaris has no prompt for names what it can prompt today", () => {
    const row = placementRow(
      input({
        preferences: { ...DEFAULT_PREDICTION_PREFERENCES, model: "qwen3-coder-30b-a3b" },
        inspection: inspection(
          { machine: machine(16), endpoints: [] },
          { machine: machine(64), endpoints: [server("qwen3-coder-30b-a3b")] }
        ),
      })
    );

    expect(row.caption).toBe(
      "Polaris can't prompt qwen3-coder-30b-a3b yet · Sweep Next-Edit or Zeta 2.1 suggest edits; Mellum2 and Qwen2.5-Coder complete at the cursor"
    );
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
    expect(memoryLine({ rssBytes: 0, processes: 0, servers: [] }, "This Mac")).toBe(
      "No model server running on this Mac"
    );
    expect(memoryLine(null, "This Mac")).toBeNull();
  });

  test("names each server and says when one is resident with nothing loaded", () => {
    expect(
      memoryLine(
        {
          rssBytes: 9.4 * GiB + 33 * 1024 ** 2,
          processes: 2,
          servers: [
            { name: "llama-server", rssBytes: 9.4 * GiB },
            { name: "ollama", rssBytes: 33 * 1024 ** 2 },
          ],
        },
        "Mac Studio"
      )
    ).toBe(
      "On Mac Studio: llama-server 9.4 GB · Ollama with nothing loaded · counted apart from Polaris"
    );
    expect(
      memoryLine(
        {
          rssBytes: 300 * 1024 ** 2,
          processes: 1,
          servers: [{ name: "LM Studio", rssBytes: 300 * 1024 ** 2 }],
        },
        "This Mac"
      )
    ).toBe("On this Mac: LM Studio 300 MB · counted apart from Polaris");
  });
});
