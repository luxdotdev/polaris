import { expect, test } from "bun:test";
import {
  AgentSession,
  Attempt,
  ConstellationId,
  Constellation,
  DomainEvent,
  HostId,
  HostResource,
  ResourceLease,
  SessionId,
  TaskId,
  WorktreeSetupRun,
  type Turn,
} from "@polaris/protocol";
import { Struct } from "effect";
import {
  A,
  AT,
  B,
  CID,
  HOST,
  dispatched,
  draft,
  planned,
  task,
} from "../engine/constellation.testing.ts";
import { WORKERS_RESOURCE, emptyResources, foldResources } from "../resources/model.ts";
import type { ConstellationRecord } from "../store/constellation.ts";
import type { SessionRecord } from "../store/model.ts";
import { newTurn } from "./delivery/turns.ts";
import { session } from "./delivery/testing.ts";
import type { HostSlots } from "./slots.ts";
import { statusOutline, statusSince } from "./status.ts";

const W_A = SessionId.make("worker-a");

const W_B = SessionId.make("worker-b");

const W_X = SessionId.make("worker-x");

const X2 = TaskId.make("X2");

const at = (ms: number) => new Date(Date.parse(AT) + ms).toISOString();

const minutes = (n: number) => at(n * 60_000);

const setupRun = (taskId: TaskId, status: WorktreeSetupRun["status"]) =>
  new WorktreeSetupRun({
    id: `setup-${taskId}`,
    constellationId: CID,
    taskId,
    command: "bun install",
    cwd: "/tmp",
    status,
    output: "",
    exitCode: status === "running" ? null : 0,
    startedAt: AT,
    endedAt: status === "running" ? null : minutes(1),
  });

const sessionRecord = (
  id: SessionId,
  turns: ReadonlyArray<Turn> = [],
  setup: WorktreeSetupRun | null = null
): SessionRecord => ({
  session: AgentSession.make(Struct.assign(session(id), { worktreeSetup: setup })),
  titleLocked: false,
  turns,
  pending: new Map(),
  subagents: new Map(),
});

const leased = (id: string, sessionId: SessionId, acquiredAt: string) => ({
  occurredAt: acquiredAt,
  event: DomainEvent.cases.ResourceLeased.make({
    lease: new ResourceLease({
      id,
      hostId: HOST,
      resource: WORKERS_RESOURCE,
      sessionId,
      command: [],
      processId: 0,
      acquiredAt,
    }),
  }),
});

const queued = (requestId: string, sessionId: SessionId, occurredAt: string) => ({
  occurredAt,
  event: DomainEvent.cases.ResourceLeaseQueued.make({
    hostId: HOST,
    resource: WORKERS_RESOURCE,
    requestId,
    sessionId,
  }),
});

/** Build has A and B on this Host; "Release flow" holds a slot with X2 from another Constellation. */
const world = (
  patch: {
    readonly aSetup?: WorktreeSetupRun;
    readonly aTurns?: Turn[];
    readonly aHeldAt?: string;
    readonly now?: string;
  } = {}
) => {
  const build = dispatched(
    dispatched(planned([task(A), task(B)]), draft(A, "a1", W_A)),
    draft(B, "b1", W_B)
  );

  const other = dispatched(planned([task(X2)]), draft(X2, "x2", W_X));
  const otherId = ConstellationId.make("c2");

  const release: ConstellationRecord = {
    ...other,
    graph: Constellation.make(Struct.assign(other.graph, { id: otherId, name: "Release flow" })),
  };

  const resources = foldResources(emptyResources(), [
    {
      occurredAt: AT,
      event: DomainEvent.cases.ResourceDeclared.make({
        resource: new HostResource({ hostId: HOST, name: WORKERS_RESOURCE, capacity: 2 }),
      }),
    },
    queued("x", W_X, AT),
    leased("x", W_X, AT),
    queued("a", W_A, minutes(2)),
    leased("a", W_A, patch.aHeldAt ?? minutes(28)),
    queued("b", W_B, minutes(30)),
  ]);

  const sessions = new Map([
    [W_A, sessionRecord(W_A, patch.aTurns ?? [], patch.aSetup ?? setupRun(A, "completed"))],
    [W_B, sessionRecord(W_B, [], setupRun(B, "completed"))],
    [W_X, sessionRecord(W_X)],
  ]);

  const host: HostSlots = {
    hostId: HOST,
    resources,
    constellations: new Map([
      [build.graph.id, build],
      [otherId, release],
    ]),
    sessions,
    now: Date.parse(patch.now ?? minutes(40)),
  };

  return { build, sessions, host };
};

test("status reads a slot holder with no Turn as stalled, as the Desktop App does, and a waiter's age", () => {
  const { build, sessions, host } = world();
  const text = statusOutline(build, sessions, host);

  expect(text).toContain("  Worker: stalled 12m · holds a slot, no Turn yet");
  expect(text).toContain("  Worker: waiting for a slot 10m (1 of 1)");
  expect(text).toContain(
    "Host slots: 2/2 held · Release flow/X2 40m stalled · A 12m stalled · waiting: B 10m"
  );
  expect(statusSince(build, [], build.graph.revision, sessions, host)).toContain(
    "Not working: A (stalled 12m), B (waiting for a slot 10m)"
  );
});

test("a slot holder reads starting for the grace period and stalled from the minute on", () => {
  const held = minutes(28);
  const early = world({ aHeldAt: held, now: at(28 * 60_000 + 59_000) });
  const late = world({ aHeldAt: held, now: at(28 * 60_000 + 60_000) });

  expect(statusOutline(early.build, early.sessions, early.host)).toContain(
    "  Worker: starting 59s\n"
  );
  expect(statusOutline(late.build, late.sessions, late.host)).toContain(
    "  Worker: stalled 1m · holds a slot, no Turn yet"
  );
});

test("status shows setup still running, then the brief's Turn running on a held slot", () => {
  const running = world({ aSetup: setupRun(A, "running") });

  expect(statusOutline(running.build, running.sessions, running.host)).toContain(
    "  Worker: setting up 40m\n"
  );

  const worker = session(W_A);
  const brief = newTurn(worker, "Build A", minutes(30), "a1:start");
  const working = world({ aTurns: [brief] });
  const text = statusOutline(working.build, working.sessions, working.host);

  expect(text).toContain("  Worker: Turn running\n");
  expect(text).toContain("A 12m running");
});

test("a slot still held for an ended Attempt names the holder with its outcome", () => {
  const { build, sessions, host } = world();
  const release = host.constellations.get(ConstellationId.make("c2"))!;

  const ended = release.graph.attempts.map((a) =>
    Attempt.make(Struct.assign(a, { state: "lost" as const, endedAt: minutes(5) }))
  );

  const stale: HostSlots = {
    ...host,
    constellations: new Map([
      [build.graph.id, build],
      [
        release.graph.id,
        {
          ...release,
          graph: Constellation.make(Struct.assign(release.graph, { attempts: ended })),
        },
      ],
    ]),
  };

  expect(statusOutline(build, sessions, stale)).toContain("Release flow/X2 (lost) 40m no Turn");
});

test("a worker on another Host reads no slot from this Host's fold", () => {
  const { build, sessions, host } = world();
  const remote: HostSlots = { ...host, hostId: HostId.make("other-host") };

  expect(statusOutline(build, sessions, remote)).toContain("  Worker: starting 39m\n");
  expect(statusOutline(build, sessions, { ...host, resources: emptyResources() })).not.toContain(
    "Host slots"
  );
});
