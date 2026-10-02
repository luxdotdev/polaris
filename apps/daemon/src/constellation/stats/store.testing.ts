import { AgentSession, CommandId, DomainEvent, Workspace, type SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import { AT, WS } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { statsFixture } from "./stats.testing.ts";

const session = (id: SessionId) =>
  AgentSession.make({
    id,
    workspaceId: WS,
    harness: "codex",
    title: id,
    cwd: "/tmp",
    worktreeId: null,
    state: "idle",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  });

export const seedStats = Effect.gen(function* () {
  const store = yield* EventStore;
  const { history } = statsFixture();
  yield* store.commit({
    commandId: CommandId.make("stats-seed"),
    decide: () =>
      Effect.succeed([
        DomainEvent.cases.WorkspaceRegistered.make({
          workspace: Workspace.make({
            id: WS,
            path: "/tmp",
            name: "Stats test",
            isGitRepo: true,
            worktreeRoot: "/tmp/trees",
            hidden: false,
            registeredAt: AT,
          }),
        }),
        ...[...history.sessions.keys()].map((id) =>
          DomainEvent.cases.SessionCreated.make({ session: session(id) })
        ),
        ...[...history.events, ...history.leases, ...[...history.sessions.values()].flat()]
          .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt))
          .map((e) => e.event),
      ]),
  });
});
