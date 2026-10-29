import { describe, expect, test } from "bun:test";
import { type Capability, Command, Model, ModelId, SessionId, TurnId } from "@polaris/protocol";
import {
  currentModel,
  effortFor,
  forkCommand,
  type ModelChange,
  modelChange,
  modelLabel,
  permissionModesFor,
} from "./modelSheet.ts";

const model = (fields: Partial<Model> = {}) =>
  new Model({
    id: ModelId.make("opus"),
    name: "Opus 5",
    description: null,
    efforts: ["low", "medium", "high"],
    defaultEffort: null,
    isDefault: true,
    ...fields,
  });

const both: ReadonlyArray<Capability> = ["session.set-model", "session.fork"];

describe("picking a model in a session", () => {
  test.each<[string, boolean, ReadonlyArray<Capability>, boolean, boolean, ModelChange["kind"]]>([
    ["switches between turns", true, both, false, true, "set"],
    ["waits for the turn in flight", true, both, true, true, "blocked"],
    ["forks where the harness can't switch", false, both, false, true, "fork"],
    ["can't fork before a turn has ended", false, both, false, false, "blocked"],
    ["forks on a Host without set-model", true, ["session.fork"], false, true, "fork"],
  ])("%s", (_, switchesModel, capabilities, turnInFlight, hasFinishedTurn, kind) => {
    expect(modelChange({ switchesModel, capabilities, turnInFlight, hasFinishedTurn }).kind).toBe(
      kind
    );
  });
});

describe("effort", () => {
  test("a pick the model doesn't take falls back to its default, else medium", () => {
    expect(effortFor(model(), "max")).toBe("medium");
    expect(effortFor(model({ defaultEffort: "high" }), null)).toBe("high");
    expect(effortFor(model(), "low")).toBe("low");
    expect(effortFor(model({ efforts: [] }), "low")).toBeNull();
  });

  test("a fork onto another harness keeps that harness's defaults", () => {
    const command = forkCommand({
      sessionId: SessionId.make("s-2"),
      fromSessionId: SessionId.make("s-1"),
      fromTurnId: TurnId.make("t-1"),
      harness: "codex",
      model: null,
      effort: "high",
    });

    expect(command).toEqual(
      Command.cases.ForkSession.make({
        sessionId: SessionId.make("s-2"),
        fromSessionId: SessionId.make("s-1"),
        fromTurnId: TurnId.make("t-1"),
        harness: "codex",
        model: null,
        effort: null,
      })
    );
  });
});

describe("permission modes", () => {
  test("Plan is offered only where the Host has plan mode", () => {
    expect(permissionModesFor([]).map((p) => p.mode)).not.toContain("plan");
    expect(permissionModesFor(["session.plan-mode"]).map((p) => p.mode)).toContain("plan");
  });
});

describe("the session's model", () => {
  const opus = model({ id: ModelId.make("claude-opus-5-5"), name: "Opus 5.5" });
  const sonnet = model({ id: ModelId.make("sonnet"), name: "Sonnet 5.5", isDefault: false });
  const listed = [opus, sonnet];

  const shown = (id: string | null) => {
    const found = currentModel(listed, id === null ? null : ModelId.make(id));

    return { model: found?.name ?? null, label: modelLabel(found, id) };
  };

  test.each<[string, string | null, { model: string | null; label: string }]>([
    ["its own", "sonnet", { model: "Sonnet 5.5", label: "Sonnet 5.5" }],
    ["none named: the default", null, { model: "Opus 5.5", label: "Opus 5.5" }],
    [
      "a bracketed variant of a listed model",
      "claude-opus-5-5[1m]",
      { model: "Opus 5.5", label: "Opus 5.5 · 1M" },
    ],
    [
      "unlisted: its id, never the default's name",
      "gpt-6-codex",
      { model: null, label: "gpt-6-codex" },
    ],
  ])("%s", (_, id, expected) => {
    expect(shown(id)).toEqual(expected);
  });
});
