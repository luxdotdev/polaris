import { Schema } from "effect";
import { DomainEvent } from "../../../protocol/src/events.ts";
import { ConstellationEvent, ResourceEvent } from "../../../protocol/src/constellation/events.ts";
import { mapGraphEvent, mapResourceEvent, ReplayGroup, resourceKey } from "./mapping.ts";

// Additive resource events are owned by C1-R; older traces omit them.
export const ResourceLeaseCanceled = Schema.TaggedStruct("ResourceLeaseCanceled", {
  hostId: Schema.String,
  resource: Schema.String,
  requestId: Schema.String,
  reason: Schema.String,
});

export const ResourceRemoved = Schema.TaggedStruct("ResourceRemoved", {
  hostId: Schema.String,
  resource: Schema.String,
});

export const ReplayContext = Schema.Struct({
  offlineSessionIds: Schema.Array(Schema.String),
  commanded: Schema.Boolean,
});

export type ReplayContext = typeof ReplayContext.Type;

export const ConstellationTrace = Schema.Struct({
  version: Schema.Literal(1),
  ownerHostId: Schema.NonEmptyString,
  batches: Schema.Array(
    Schema.Struct({
      hostId: Schema.NonEmptyString,
      context: Schema.optionalKey(ReplayContext),
      events: Schema.Array(Schema.Union([DomainEvent, ResourceLeaseCanceled, ResourceRemoved])),
      /** A freshly committed owner receipt, including a refused remote intent. Not an RPC retry. */
      outboxId: Schema.optionalKey(Schema.NonEmptyString),
      constellationId: Schema.optionalKey(Schema.NonEmptyString),
    })
  ),
});

export type ConstellationTrace = typeof ConstellationTrace.Type;

export const decodeConstellationTrace = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.toCodecJson(ConstellationTrace))
);

export interface ReplaySource {
  readonly name: string;
  readonly source: string;
  readonly batches: number;
  readonly events: number;
}

const graphEvent = Schema.is(ConstellationEvent);

export const ReplayResourceEvent = Schema.Union([
  ResourceEvent.cases.ResourceDeclared,
  ResourceEvent.cases.ResourceLeaseQueued,
  ResourceEvent.cases.ResourceLeased,
  ResourceEvent.cases.ResourceReleased,
]);

export type ReplayResourceEvent = typeof ReplayResourceEvent.Type;

const resourceEvent = Schema.is(ReplayResourceEvent);

const canceledEvent = Schema.is(ResourceLeaseCanceled);

const removedEvent = Schema.is(ResourceRemoved);

const getGroup = (groups: Map<string, ReplayGroup>, key: string, owner: string) => {
  const existing = groups.get(key);

  if (existing !== undefined) return existing;
  const group = new ReplayGroup(owner);
  groups.set(key, group);

  return group;
};

const attachOutbox = (
  mapped: Map<ReplayGroup, Array<string>>,
  groups: Map<string, ReplayGroup>,
  batch: ConstellationTrace["batches"][number],
  owner: string
) => {
  if (batch.outboxId === undefined) return;

  const candidates =
    batch.constellationId === undefined
      ? [...groups.values()].filter((group) => group.owner === owner && group.isGraph)
      : [groups.get(`graph:${batch.constellationId}`)].filter((group) => group !== undefined);

  const inBatch = [...mapped.keys()].filter((group) => group.isGraph);
  const graphs = batch.constellationId === undefined && inBatch.length > 0 ? inBatch : candidates;

  if (graphs.length !== 1 || !graphs[0]!.started)
    throw new Error(
      "outboxId requires one started Constellation; use batch.constellationId for an empty receipt batch with multiple graphs"
    );
  const group = graphs[0]!;
  const events = mapped.get(group) ?? [];
  events.unshift(group.event(batch.hostId, `OutboxApplied(${group.outboxId(batch.outboxId)})`));
  mapped.set(group, events);
};

/** Split graph and Host resource streams; replay each committed batch through the reference fold. */
export const constellationTraceToQuint = (
  name: string,
  trace: ConstellationTrace,
  modelPath: string
): ReadonlyArray<ReplaySource> => {
  const groups = new Map<string, ReplayGroup>();

  for (const batch of trace.batches) {
    const mapped = new Map<ReplayGroup, Array<string>>();

    for (const event of batch.events) {
      if (graphEvent(event)) {
        const group = getGroup(groups, `graph:${event.constellationId}`, trace.ownerHostId);
        const items = mapped.get(group) ?? [];
        items.push(...mapGraphEvent(group, event, batch.hostId, batch.context));
        mapped.set(group, items);
      } else if (resourceEvent(event)) {
        const key = resourceKey(event);
        const group = getGroup(groups, `resource:${key.host}:${key.name}`, key.host);
        const items = mapped.get(group) ?? [];
        items.push(...mapResourceEvent(group, event, batch.hostId));
        mapped.set(group, items);
      } else if (canceledEvent(event) || removedEvent(event)) {
        const group = getGroup(groups, `resource:${event.hostId}:${event.resource}`, event.hostId);
        const items = mapped.get(group) ?? [];
        items.push(
          group.event(
            batch.hostId,
            canceledEvent(event)
              ? `ResourceLeaseCanceled(${group.requestId(event.requestId)})`
              : "ResourceRemoved"
          )
        );
        mapped.set(group, items);
      }
    }

    attachOutbox(mapped, groups, batch, trace.ownerHostId);

    for (const [group, events] of mapped) group.batches.push(events);
  }

  if (groups.size === 0) throw new Error("trace has no Constellation or resource events");

  return [...groups.values()].map((group, index) => {
    const main = `${name}_${index}`;

    const lines = group.batches.map(
      (events) => `      .then(replay([${events.join(", ")}])).expect(safety)`
    );

    return {
      name: main,
      batches: group.batches.length,
      events: group.batches.reduce((count, events) => count + events.length, 0),
      source: `module ${main} {
  import constellations(
    TASKS = ${group.tasks.set()}, SESSIONS = ${group.sessions.set()}, IDS = ${group.requests.set()},
    OWNER = ${JSON.stringify(group.owner)}, CAPACITY = ${group.capacity},
  ).* from ${JSON.stringify(modelPath)}
  run replayTest = init
${lines.join("\n")}
}
`,
    };
  });
};
