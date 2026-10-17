import { expect, test } from "bun:test";
import {
  AgentSession,
  Attempt,
  ConstellationId,
  Constellation,
  DomainEvent,
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

const minutes = (n: number) => new Date(Date.parse(AT) + n * 60_000).toISOString();

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

/** Build has A and B on this Host; "Release flow" holds a slot with X2 from another Constellation. */
const world = (patch: { readonly aSetup?: WorktreeSetupRun; readonly aTurns?: Turn[] } = {}) => {
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

  const lease = (id: string, sessionId: SessionId, at: string) =>
    DomainEvent.cases.ResourceLeased.make({
      lease: new ResourceLease({
        id,
        hostId: HOST,
        resource: WORKERS_RESOURCE,
        sessionId,
        command: [],
        processId: 0,
        acquiredAt: at,
      }),
    });

  const queue = (requestId: string, sessionId: SessionId) =>
    DomainEvent.cases.ResourceLeaseQueued.make({
      hostId: HOST,
      resource: WORKERS_RESOURCE,
      requestId,
      sessionId,
    });

  const resources = foldResources(emptyResources(), [
    DomainEvent.cases.ResourceDeclared.make({
      resource: new HostResource({ hostId: HOST, name: WORKERS_RESOURCE, capacity: 2 }),
    }),
    queue("x", W_X),
    lease("x", W_X, AT),
    queue("a", W_A),
    lease("a", W_A, minutes(28)),
    queue("b", W_B),
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
    now: Date.parse(minutes(40)),
  };

  return { build, sessions, host };
};

test("status tells a slot holder with no Turn from a queued worker and names every Host holder", () => {
  const { build, sessions, host } = world();
  const text = statusOutline(build, sessions, host);

  expect(text).toContain("  Worker: no Turn yet · setup done · slot held 12m");
  expect(text).toContain("  Worker: no Turn yet · setup done · waiting for a slot (1 of 1)");
  expect(text).toContain(
    "Host slots: 2/2 held · Release flow/X2 40m no Turn · A 12m no Turn · waiting: B"
  );
  expect(statusSince(build, [], build.graph.revision, sessions, host)).toContain(
    "Host slots: 2/2 held · Release flow/X2 40m no Turn · A 12m no Turn · waiting: B"
  );
});

test("status shows setup still running, then a running Turn on a held slot", () => {
  const running = world({ aSetup: setupRun(A, "running") });

  expect(statusOutline(running.build, running.sessions, running.host)).toContain(
    "  Worker: no Turn yet · setup running · slot held 12m"
  );

  const worker = session(W_A);
  const working = world({ aTurns: [newTurn(worker, "Build A", minutes(30))] });
  const text = statusOutline(working.build, working.sessions, working.host);

  expect(text).toContain("  Worker: Turn running · setup done · slot held 12m");
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

test("a Host with no worker slots in use adds no slot line", () => {
  const { build, sessions, host } = world();
  const idle: HostSlots = { ...host, resources: emptyResources() };

  expect(statusOutline(build, sessions, idle)).not.toContain("Host slots");
  expect(statusOutline(build, sessions, idle)).toContain(
    "  Worker: no Turn yet · setup done · no slot"
  );
});
