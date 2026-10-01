import { describe, expect, test } from "bun:test";
import { lineage, type ModelData, shortlist } from "./models.ts";

const row = (id: string, name: string, isDefault = false): ModelData => ({
  id,
  name,
  description: null,
  efforts: ["low", "medium", "high"],
  defaultEffort: null,
  isDefault,
});

/** Claude Code 2.1.286's `supportedModels()`, in its order. */
const claude = [
  row("default", "Default (recommended)", true),
  row("opus", "Opus 5.5"),
  row("claude-fable-5-1", "Fable 5.1"),
  row("sonnet", "Sonnet 5.5"),
  row("haiku", "Haiku 4.5"),
  row("claude-sonnet-5", "Sonnet 5"),
  row("claude-opus-5", "Opus 5"),
  row("claude-fable-5", "Fable 5"),
  row("claude-opus-4-8", "Opus 4.8"),
  row("claude-opus-4-7", "Opus 4.7"),
  row("claude-opus-4-6", "Opus 4.6"),
  row("claude-sonnet-4-6", "Sonnet 4.6"),
];

/** Codex 0.159.2's `model/list`, in its order. */
const codex = [
  row("gpt-6.1-sol", "GPT-6.1-Sol", true),
  row("gpt-6-astra", "GPT-6-Astra"),
  row("gpt-6-sol", "GPT-6-Sol"),
  row("gpt-6-luna", "GPT-6-Luna"),
  row("gpt-5.6-sol", "GPT-5.6-Sol"),
  row("gpt-5.6-terra", "GPT-5.6-Terra"),
  row("gpt-5.6-luna", "GPT-5.6-Luna"),
  row("gpt-daybreak-blue-latest", "Daybreak Blue"),
  row("gpt-5.5", "GPT-5.5"),
];

const names = (models: ReadonlyArray<ModelData>) => models.map((m) => m.name);

describe("the Model shortlist", () => {
  test("reads a family and version from the name", () => {
    expect(lineage("Opus 5.5")).toEqual({ family: "opus", version: [5, 5] });
    expect(lineage("GPT-6.1-Sol")).toEqual({ family: "gpt sol", version: [6, 1] });
    expect(lineage("Daybreak Blue")).toEqual({ family: "daybreak blue", version: null });
  });

  test("Claude: the newest of each family, Opus 5.5, Fable 5.1, Sonnet 5.5, Haiku 4.5", () => {
    const { top, more } = shortlist("claude", claude);

    expect(names(top)).toEqual(["Opus 5.5", "Fable 5.1", "Sonnet 5.5", "Haiku 4.5"]);
    expect(names(more)).toEqual([
      "Sonnet 5",
      "Opus 5",
      "Fable 5",
      "Opus 4.8",
      "Opus 4.7",
      "Opus 4.6",
      "Sonnet 4.6",
    ]);
  });

  test("Codex: its newest four, the rest under More models", () => {
    const { top, more } = shortlist("codex", codex);

    expect(names(top)).toEqual(["GPT-6.1-Sol", "GPT-6-Astra", "GPT-6-Luna", "GPT-5.6-Terra"]);
    expect(names(more)).toEqual([
      "GPT-6-Sol",
      "GPT-5.6-Sol",
      "GPT-5.6-Luna",
      "Daybreak Blue",
      "GPT-5.5",
    ]);
  });

  test("the Harness's default is always shown", () => {
    const listed = [
      row("a-6", "A 6"),
      row("b-6", "B 6"),
      row("c-6", "C 6"),
      row("d-6", "D 6"),
      row("e-6", "E 6", true),
    ];

    expect(names(shortlist("codex", listed).top)).toEqual(["A 6", "B 6", "C 6", "E 6"]);
  });

  test("the same Model listed twice shows once", () => {
    const listed = [row("opus", "Opus 5.5"), row("claude-opus-5-5", "Opus 5.5")];

    expect(shortlist("claude", listed).top.map((m) => m.id)).toEqual(["opus"]);
  });

  test("short lists show whole", () => {
    expect(names(shortlist("codex", codex.slice(0, 2)).top)).toEqual([
      "GPT-6.1-Sol",
      "GPT-6-Astra",
    ]);
  });
});
