import type {
  EditPredictionFormat,
  PredictionCapability,
  PredictionFormat,
  PredictionMachine,
} from "@polaris/protocol";

export type MachineFacts = PredictionMachine;

export type CapabilityReport = PredictionCapability;

export type ReachableEndpoint = PredictionCapability["endpoints"][number];

export type PredictionSide = "client" | "host";

export type PlacementOverride = "auto" | "client" | "host" | "off";

export interface PredictionTarget {
  readonly side: PredictionSide;
  readonly endpoint: ReachableEndpoint;
  readonly model: string;
  readonly format: PredictionFormat | EditPredictionFormat;
  readonly tier: number;
  readonly p50Ms: number | null;
  /** The endpoint is a model server the serving Daemon runs itself (ADR 0048). */
  readonly managed: boolean;
}

export interface PlacementInput {
  /** Auto prefers next-edit models and falls back to FIM; complete preserves insertion-only callers. */
  readonly mode?: "complete" | "edit" | "auto";
  readonly client: CapabilityReport | null;
  readonly host: CapabilityReport | null;
  readonly override: PlacementOverride;
  readonly model?: string | null;
  readonly format?: PredictionTarget["format"] | null;
  readonly latency?:
    | ((side: PredictionSide, endpoint: ReachableEndpoint) => number | null)
    | undefined;
}
