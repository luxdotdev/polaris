import { describe, expect, test } from "bun:test";
import {
  AgentSession,
  CELESTIAL_PLANETS,
  DomainEvent,
  EventEnvelope,
  Sequence,
  SessionId,
  Timestamp,
  WorkspaceId,
} from "@polaris/protocol";
import { pickCelestial } from "./celestial.ts";
import { emptyModel, project, type ReadModel } from "./model.ts";

const AT = Timestamp.make("2026-10-28T00:00:00.000Z");

const session = (
  id: string,
  fields: Partial<Pick<AgentSession, "workspaceId" | "state" | "celestial">> = {}
) =>
  new AgentSession({
    id: SessionId.make(id),
    workspaceId: WorkspaceId.make("w"),
    harness: "claude",
    title: id,
    cwd: "/repo",
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
    ...fields,
  });

let sequence = 0;

const fold = (model: ReadModel, event: DomainEvent) =>
  project(
    model,
    new EventEnvelope({
      sequence: Sequence.make(++sequence),
      occurredAt: AT,
      commandId: null,
      event,
    })
  );

/** Each session created in turn, picked against the ones before it, as the decider does. */
const createAll = (ids: ReadonlyArray<string>) =>
  ids.reduce((model, id) => {
    const next = session(id, { celestial: pickCelestial(model.sessions.values(), session(id)) });

    return fold(model, DomainEvent.cases.SessionCreated.make({ session: next }));
  }, emptyModel);

const planetOf = (model: ReadModel, id: string) =>
  model.sessions.get(SessionId.make(id))?.session.celestial;

describe("pickCelestial", () => {
  test("no two active sessions in a Workspace share a planet while one is free", () => {
    const ids = CELESTIAL_PLANETS.map((_, i) => `s-${i}`);
    const model = createAll(ids);

    expect(new Set(ids.map((id) => planetOf(model, id))).size).toBe(CELESTIAL_PLANETS.length);
  });

  test("archived sessions and other Workspaces leave their planets free", () => {
    const [free, ...rest] = CELESTIAL_PLANETS;

    const records = [
      session("archived", { celestial: free, state: "archived" }),
      session("elsewhere", { celestial: free, workspaceId: WorkspaceId.make("other") }),
      ...rest.map((planet, i) => session(`s-${i}`, { celestial: planet })),
    ].map((s) => ({ session: s }));

    expect(pickCelestial(records, session("new"))).toBe(free);
  });

  test("when every planet is shown, a new session takes the least shared one", () => {
    const records = [...CELESTIAL_PLANETS, ...CELESTIAL_PLANETS.slice(0, -1)].map((planet, i) => ({
      session: session(`s-${i}`, { celestial: planet }),
    }));

    expect(pickCelestial(records, session("new"))).toBe(CELESTIAL_PLANETS.at(-1) ?? "none");
  });
});

describe("folding a session's Celestial", () => {
  test("a session logged before Celestials gets the planet it would have been picked", () => {
    const legacy = DomainEvent.cases.SessionCreated.make({ session: session("old") });
    const model = fold(createAll(["a", "b"]), legacy);
    const expected = pickCelestial(createAll(["a", "b"]).sessions.values(), session("old"));

    expect(planetOf(model, "old")).toBe(expected);
    expect([planetOf(model, "a"), planetOf(model, "b")]).not.toContain(expected);
  });

  test("a session keeps its planet through later session events", () => {
    const model = createAll(["a"]);
    const before = planetOf(model, "a");

    const renamed = fold(
      model,
      DomainEvent.cases.SessionRenamed.make({ sessionId: SessionId.make("a"), title: "renamed" })
    );

    expect(planetOf(renamed, "a")).toBe(before);
    expect(before).not.toBeNull();
  });
});
