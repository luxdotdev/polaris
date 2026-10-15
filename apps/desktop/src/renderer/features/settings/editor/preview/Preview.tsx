/**
 * `#tab-completion/<scene>`: Settings → Editor → Tab completion on fixtures, for screenshots.
 * `hosts` has seven Hosts (a Pi, a long name, Offline and Reconnecting) and a running model
 * server; `empty` has no model server anywhere.
 */
import { Option, Schema } from "effect";
import { createRoot } from "react-dom/client";
import type { HostView, PolarisApi, RequestOutput } from "../../../../../shared/api.ts";
import { ManagedServerPhase, type ManagedServerStatus } from "@polaris/protocol";
import type { PredictionInspection } from "../../../../../shared/predictionContract.ts";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  type PredictionPreferences,
} from "../../../../../shared/predictionPlacement.ts";
import { HOSTS as NEEDS_YOU_HOSTS } from "../../../needs-you/preview/fixtures.ts";
import { standInBridge } from "../../../bridge.ts";
import { predictionStore } from "../../../editor/prediction/store.ts";
import { Column } from "../../ui/parts.tsx";
import { TabCompletion } from "../TabCompletion.tsx";

const GiB = 1024 ** 3;

const host = (key: string, label: string, state: HostView["status"]["state"] = "connected") => {
  const base = NEEDS_YOU_HOSTS[0];

  if (base === undefined) throw new Error("needs-you fixtures have no Host");

  return {
    ...base,
    key,
    label,
    alias: key === "local" ? null : key,
    status: { ...base.status, state },
  };
};

const HOSTS: ReadonlyArray<HostView> = [
  host("local", "This Mac"),
  host("studio", "Mac Studio"),
  host("vm", "Linux VM"),
  host("pi", "Pi 4"),
  host("build", "build-farm-eu-west-2.internal.example.com"),
  host("work", "Work", "reconnecting"),
  host("nas", "NAS", "offline"),
];

const machine = (ramGiB: number, chip: string) => ({
  chip,
  cpuCores: 8,
  ramBytes: ramGiB * GiB,
  gpu: null,
  gpuMemoryBytes: null,
  unifiedMemory: true,
  load: null,
});

const server = (...models: ReadonlyArray<string>) => [
  { kind: "openai" as const, url: "http://127.0.0.1:8080", models },
];

const MACHINES = new Map<string, NonNullable<PredictionInspection["host"]>>([
  ["local", { machine: machine(36, "Apple M3 Pro"), endpoints: [] }],
  [
    "studio",
    { machine: machine(128, "Apple M2 Ultra"), endpoints: server("mellum2-12b-a2.5b-q4_k_m") },
  ],
  ["vm", { machine: machine(16, "Neoverse-N1"), endpoints: [] }],
  ["pi", { machine: machine(8, "Raspberry Pi 4 Model B Rev 1.4"), endpoints: [] }],
  ["build", { machine: machine(64, "AMD EPYC 7763"), endpoints: server("qwen3-coder-30b-a3b") }],
]);

type Answer = RequestOutput<
  | "prediction.enabled.get"
  | "prediction.clientEndpoints.get"
  | "prediction.settings.get"
  | "prediction.inspect"
  | "prediction.resources.get"
  | "prediction.managed"
>;

/** The Client's managed server: nothing downloaded in the empty scene, Sweep downloaded otherwise. */
const managedStatus = (empty: boolean): ManagedServerStatus => ({
  model: {
    id: "sweep-next-edit-1.5b",
    name: "Sweep Next-Edit 1.5B",
    sizeBytes: 1_537_269_856,
    serverBytes: 11_971_406,
    memoryBytes: 2_600_000_000,
  },
  modelsDir: "/Users/lucas/.polaris/models",
  freeBytes: 211 * GiB,
  endpoint: empty ? null : { kind: "openai", url: "http://127.0.0.1:43210" },
  phase: empty
    ? ManagedServerPhase.cases.Absent.make({})
    : ManagedServerPhase.cases.Stopped.make({}),
  memoryBytes: null,
});

const HostInput = Schema.Struct({ hostKey: Schema.optional(Schema.String) });

const fixtureBridge = (empty: boolean): PolarisApi => {
  const clientEndpoints = empty ? [] : server("mellum2-12b-a2.5b", "qwen2.5-coder-1.5b");

  const inspection = (hostKey: string): PredictionInspection => ({
    clientLabel: "This Mac",
    hostLabel: HOSTS.find((h) => h.key === hostKey)?.label ?? hostKey,
    client: { machine: machine(36, "Apple M3 Pro"), endpoints: clientEndpoints },
    host: empty ? null : (MACHINES.get(hostKey) ?? null),
    offer: false,
    managed: { client: managedStatus(empty), host: null },
  });

  const preferences = (hostKey: string): PredictionPreferences =>
    hostKey === "build"
      ? { ...DEFAULT_PREDICTION_PREFERENCES, placement: "host", model: "qwen3-coder-30b-a3b" }
      : DEFAULT_PREDICTION_PREFERENCES;

  return {
    request: async (method, input) => {
      const hostKey = Option.getOrUndefined(Schema.decodeUnknownOption(HostInput)(input))?.hostKey;
      let value: Answer;

      switch (method) {
        case "prediction.enabled.get":
          value = { enabled: !empty, configured: !empty };
          break;
        case "prediction.clientEndpoints.get":
          value = clientEndpoints.map(({ kind, url }) => ({ kind, url }));
          break;
        case "prediction.settings.get":
          value = preferences(hostKey ?? "local");
          break;
        case "prediction.inspect":
          value = inspection(hostKey ?? "local");
          break;
        case "prediction.managed":
          value = managedStatus(empty);
          break;
        case "prediction.resources.get":
          value = empty
            ? { rssBytes: 0, processes: 0, servers: [] }
            : {
                rssBytes: 9.4 * GiB,
                processes: 1,
                servers: [{ name: "llama-server", rssBytes: 9.4 * GiB }],
              };
          break;
        default:
          return { ok: false, error: { code: "Unsupported", message: "preview" } };
      }
      // SAFETY: each handled fixture method sets its documented output.

      return { ok: true, value: value as never };
    },
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  };
};

export const mountTabCompletionPreview = (root: HTMLElement, hash: string) => {
  const empty = hash.replace(/^#tab-completion\//, "") === "empty";
  standInBridge(fixtureBridge(empty));

  if (!empty)
    predictionStore.setState({
      results: { vm: { model: "mellum2-12b-a2.5b", machine: "This Mac", elapsedMs: 84 } },
    });

  createRoot(root).render(
    <div className="bg-bg min-h-screen" data-testid="tab-completion-preview">
      <Column>
        <TabCompletion hosts={HOSTS} />
      </Column>
    </div>
  );

  return () => undefined;
};
