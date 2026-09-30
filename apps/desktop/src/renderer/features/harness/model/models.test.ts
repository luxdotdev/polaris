import { describe, expect, test } from "bun:test";
import {
  choose,
  defaultChoice,
  effortFor,
  effortNote,
  type ModelData,
  modelChange,
  modelLabel,
  pickableModels,
} from "./models.ts";

const model = (id: string, patch: Partial<ModelData> = {}): ModelData => ({
  id,
  name: id.toUpperCase(),
  description: null,
  efforts: ["low", "medium", "high"],
  defaultEffort: "medium",
  isDefault: false,
  ...patch,
});

const claude = [
  model("default", { name: "Default (recommended)", isDefault: true, defaultEffort: null }),
  model("opus", { name: "Opus 5", efforts: ["low", "medium", "high", "max"], defaultEffort: null }),
  model("haiku", { name: "Haiku", efforts: [], defaultEffort: null }),
];

describe("Model picker", () => {
  test("Claude's default row is hidden; other Harnesses keep every row", () => {
    expect(pickableModels("claude", claude).map((m) => m.id)).toEqual(["opus", "haiku"]);
    expect(pickableModels("codex", claude)).toHaveLength(3);
  });

  test("the effort sent is the pick if supported, else the Model's default", () => {
    const gpt = model("gpt-5.5", { defaultEffort: "high" });

    expect(effortFor(gpt, "low")).toBe("low");
    expect(effortFor(gpt, "xhigh")).toBe("high");
    expect(choose(gpt)).toEqual({ model: "gpt-5.5", effort: "high" });
  });

  test("with no default effort, Polaris sends medium (or the first) and says so", () => {
    const [, opus] = claude;
    const odd = model("odd", { efforts: ["quick", "deep"], defaultEffort: null });

    expect(opus === undefined ? null : choose(opus)).toEqual({ model: "opus", effort: "medium" });
    expect(choose(odd).effort).toBe("quick");
    expect(opus === undefined ? null : effortNote("Claude Code", opus)).toBe(
      "Claude Code doesn't say Opus 5's default effort; Polaris sends medium."
    );
    expect(effortNote("Codex", model("gpt"))).toBeNull();
  });

  test("a Model without efforts sends none", () => {
    const haiku = claude[2];

    expect(haiku === undefined ? null : choose(haiku)).toEqual({ model: "haiku", effort: null });
  });

  test("labels: null reads Default, the effort follows the name", () => {
    expect(modelLabel(claude, null, null)).toBe("Default");
    expect(modelLabel(claude, "opus", "high")).toBe("Opus 5 · high");
    expect(modelLabel([], "gpt-9", null)).toBe("gpt-9");
  });

  test("a new session starts on the Harness's default; Claude sends null", () => {
    expect(defaultChoice("claude", claude)).toBeNull();
    expect(defaultChoice("codex", [model("a"), model("b", { isDefault: true })])).toEqual({
      model: "b",
      effort: "medium",
    });
  });
});

describe("changing Model in a session", () => {
  const base = {
    switchesModel: true,
    canSetModel: true,
    canFork: true,
    turnInFlight: false,
    hasFinishedTurn: true,
  };

  test("between Turns, a switching Harness takes SetModel", () => {
    expect(modelChange(base)).toEqual({ kind: "set" });
  });

  test("mid-Turn, SetModel waits", () => {
    expect(modelChange({ ...base, turnInFlight: true }).kind).toBe("blocked");
  });

  test("a Harness that can't switch offers a Fork on the Model", () => {
    expect(modelChange({ ...base, switchesModel: false })).toEqual({ kind: "fork" });
    expect(modelChange({ ...base, canSetModel: false })).toEqual({ kind: "fork" });
  });

  test("nothing to fork from, or no fork: blocked with a reason", () => {
    expect(modelChange({ ...base, switchesModel: false, hasFinishedTurn: false }).kind).toBe(
      "blocked"
    );
    expect(modelChange({ ...base, switchesModel: false, canFork: false }).kind).toBe("blocked");
  });
});
