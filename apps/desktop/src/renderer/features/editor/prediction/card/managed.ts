/**
 * The status card's setup states (DESIGN.md, Tab completion setup): what the managed model
 * server on the serving side is doing, and the one step the user takes next.
 */
import type { ManagedServerStatus } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { ManagedInspection } from "../../../../../shared/predictionContract.ts";
import type { PredictionPreferences } from "../../../../../shared/predictionPlacement.ts";

export type ManagedSide = "client" | "host";

export interface ManagedView {
  readonly side: ManagedSide;
  readonly status: ManagedServerStatus;
}

const GB = 1e9;

export const gb = (bytes: number) =>
  bytes >= 10 * GB ? `${Math.round(bytes / GB)} GB` : `${(bytes / GB).toFixed(1)} GB`;

const usable = (status: ManagedServerStatus | null) =>
  status !== null && !Predicate.isTagged(status.phase, "Unsupported");

/** The side whose managed server the card shows: the Host when set to it, else the Client's own. */
export const managedOf = (
  managed: ManagedInspection | undefined,
  placement: PredictionPreferences["placement"]
): ManagedView | null => {
  if (managed === undefined) return null;

  const order: ReadonlyArray<ManagedSide> =
    placement === "host" ? ["host", "client"] : ["client", "host"];

  const side = order.find((candidate) => usable(managed[candidate])) ?? order[0]!;
  const status = managed[side];

  return status === null ? null : { side, status };
};

export const managedBusy = (view: ManagedView | null) =>
  view !== null &&
  Match.value(view.status.phase).pipe(
    Match.tags({
      Downloading: () => true,
      Verifying: () => true,
      Starting: () => true,
      Backoff: () => true,
    }),
    Match.orElse(() => false)
  );

/** 0..1 while downloading; null when there's nothing to measure. */
export const managedProgress = (view: ManagedView | null): number | null =>
  view === null
    ? null
    : Match.value(view.status.phase).pipe(
        Match.tag("Downloading", (phase) =>
          phase.totalBytes === 0 ? 0 : Math.min(1, phase.receivedBytes / phase.totalBytes)
        ),
        Match.orElse(() => null)
      );

const sizeLine = (status: ManagedServerStatus) => {
  const whole = status.model.sizeBytes + status.model.serverBytes;
  const free = status.freeBytes === null ? "" : ` · ${gb(status.freeBytes)} free`;

  return `${gb(whole)} download${free}`;
};

export const FAILURE_TITLES = {
  "no-space": "Not enough space",
  "download-failed": "The download stopped",
  "checksum-mismatch": "The download didn't verify",
  "server-failed": "The model server won't start",
  "folder-unwritable": "Can't write to the model folder",
} as const;

/** The headline for a managed phase; null hands the card back to its usual states. */
export const managedHeadline = (
  view: ManagedView,
  machine: string
): { readonly title: string; readonly why: string } | null => {
  const { status } = view;
  const name = status.model.name;

  return Match.value(status.phase).pipe(
    Match.tag("Absent", () => ({
      title: "Set up tab completion",
      why: `Download ${name} to ${machine} (${sizeLine(status)}). Polaris runs it there and stops it when idle.`,
    })),
    Match.tag("Downloading", (phase) => ({
      title: `Downloading ${phase.file === "server" ? "the model server" : name}`,
      why: `${gb(phase.receivedBytes)} of ${gb(phase.totalBytes)} to ${machine}. You can keep working; it resumes if interrupted.`,
    })),
    Match.tag("Verifying", () => ({
      title: `Verifying ${name}`,
      why: `Checking the download against its published checksum on ${machine}.`,
    })),
    Match.tag("Starting", () => ({
      title: `Loading ${name}`,
      why: `The model server on ${machine} is loading the model; completions follow in a moment.`,
    })),
    Match.tag("Backoff", (phase) => ({
      title: "The model server stopped",
      why: `Restarting on ${machine} in ${Math.ceil(phase.retryInMs / 1000)} s (attempt ${phase.attempt + 1}).`,
    })),
    Match.tag("Failed", (phase) => ({
      title: FAILURE_TITLES[phase.reason],
      why: phase.message.length > 0 ? `${phase.message}.` : `${name} isn't usable on ${machine}.`,
    })),
    Match.tag("Unsupported", (phase) => ({
      title: "Can't run a model server here",
      why:
        phase.reason === "too-small"
          ? `${machine} is too small to run a next-edit model. Point Polaris at your own model server instead.`
          : `Polaris has no model server build for ${machine}. Point it at your own model server instead.`,
    })),
    Match.orElse(() => null)
  );
};

/** The server's last lines when it won't start, for the card's failure block. */
export const managedLog = (view: ManagedView | null): string | null =>
  view === null
    ? null
    : Match.value(view.status.phase).pipe(
        Match.tag("Failed", (phase) => (phase.log.length === 0 ? null : phase.log.join("\n"))),
        Match.orElse(() => null)
      );
