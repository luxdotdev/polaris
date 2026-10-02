/**
 * Settings → Hosts → Resources as data (spec §8): each resource with its holders and queue,
 * and the worker cap. The snapshot is C1-R's `HostResourcesSnapshot` (`host.resources.get`
 * and every mutation answer with it). Pure, so it is tested.
 */
import type { HostResource, ResourceLease } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";

export interface WorkerCap {
  /** The cap in force: the user's, or the automatic one (`setCap(null)` restores it). */
  readonly cap: number;
  /** About one per three cores (Mac Studio 4, devbox 2, Pi 1). */
  readonly default: number;
  readonly working: number;
  /** Attempts waiting for a slot on this Host. */
  readonly waiting: number;
}

export interface HostResourcesSnapshot {
  readonly resources: ReadonlyArray<Plain<HostResource>>;
  readonly resourceLeases: ReadonlyArray<Plain<ResourceLease>>;
  readonly waiting: ReadonlyArray<{ readonly resource: string; readonly requestId: string }>;
  readonly overdueLeaseIds: ReadonlyArray<string>;
  readonly workerCap: WorkerCap;
}

/** The hold limit when a resource doesn't set one (spec §8: warns, never kills). */
export const DEFAULT_HOLD_LIMIT_MS = 30 * 60_000;

export interface Holder {
  readonly leaseId: string;
  /** "B2", a session's title, or "a command" when no session took it. */
  readonly who: string;
  readonly command: string;
  readonly since: string;
  readonly overdue: boolean;
}

export interface ResourceRow {
  readonly name: string;
  readonly capacity: number;
  readonly holdLimitMs: number;
  readonly holders: ReadonlyArray<Holder>;
  readonly waiting: number;
}

/** Who holds a lease: the Task id of its Attempt, else its session's title. */
export type HolderName = (lease: Plain<ResourceLease>) => string | null;

export const resourceRows = (
  snapshot: HostResourcesSnapshot,
  nameOf: HolderName
): ReadonlyArray<ResourceRow> => {
  const overdue = new Set(snapshot.overdueLeaseIds);

  return [...snapshot.resources]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((resource) => ({
      name: resource.name,
      capacity: resource.capacity,
      holdLimitMs: resource.holdLimitMs ?? DEFAULT_HOLD_LIMIT_MS,
      holders: snapshot.resourceLeases
        .filter((l) => l.resource === resource.name)
        .sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt))
        .map((lease) => ({
          leaseId: lease.id,
          who: nameOf(lease) ?? "a command",
          command: lease.command.join(" "),
          since: lease.acquiredAt,
          overdue: overdue.has(lease.id),
        })),
      waiting: snapshot.waiting.filter((w) => w.resource === resource.name).length,
    }));
};

/** "held by B2 · bun run bench", "free", with the queue: "· 2 waiting". */
export const holdLine = (row: ResourceRow) => {
  const held =
    row.holders.length === 0 ? "free" : row.holders.map((h) => `held by ${h.who}`).join(", ");

  return row.waiting === 0 ? held : `${held} · ${row.waiting} waiting`;
};

/** The cap in force. */
export const capInForce = (cap: WorkerCap) => cap.cap;

/** The snapshot doesn't say whether the user set it, so a cap equal to the default reads as automatic. */
export const isAutomatic = (cap: WorkerCap) => cap.cap === cap.default;

/** "2 of 4 working · 1 waiting for a slot". */
export const capLine = (cap: WorkerCap) => {
  const working = `${cap.working} of ${capInForce(cap)} working`;

  return cap.waiting === 0 ? working : `${working} · ${cap.waiting} waiting for a slot`;
};

/** A resource name `polaris lease <name>` accepts: letters, digits, dot, dash, underscore. */
export const RESOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const validCapacity = (n: number) => Number.isInteger(n) && n >= 1 && n <= 64;
