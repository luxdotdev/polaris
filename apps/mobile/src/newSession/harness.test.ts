import { describe, expect, test } from "bun:test";
import {
  HarnessAvailability,
  HostHarnesses,
  Model,
  ModelId,
  type HarnessStatus,
} from "@polaris/protocol";
import { defaultHarness, harnessOptions, modelLabel, shortlist } from "./harness.ts";

const availability = (harness: string, status: HarnessStatus) =>
  HarnessAvailability.make({
    harness,
    status,
    version: null,
    minVersion: "1.0.0",
    olderThanTested: null,
    signInKind: null,
    detail: null,
    signInArgv: null,
  });

const report = (...entries: ReadonlyArray<HarnessAvailability>) =>
  HostHarnesses.make({ harnesses: entries, checkedAt: "2026-10-27T09:00:00Z" });

const model = (id: string, name: string, isDefault = false) =>
  Model.make({
    id: ModelId.make(id),
    name,
    description: null,
    efforts: [],
    defaultEffort: null,
    isDefault,
  });

describe("harnessOptions", () => {
  test("offers ready and needs-sign-in harnesses only; only ready ones start", () => {
    const options = harnessOptions(
      report(
        availability("claude", "ready"),
        availability("codex", "needs-sign-in"),
        availability("opencode", "not-installed"),
        availability("gemini", "outdated")
      )
    );

    expect(options.map((o) => [o.name, o.startable])).toEqual([
      ["Claude Code", true],
      ["Codex", false],
    ]);
  });
});

describe("defaultHarness", () => {
  const options = harnessOptions(
    report(
      availability("claude", "ready"),
      availability("codex", "ready"),
      availability("opencode", "needs-sign-in")
    )
  );

  test("is the most recently used ready harness", () => {
    const lastUsed = new Map([
      ["claude", "2026-10-26T10:00:00Z"],
      ["codex", "2026-10-27T10:00:00Z"],
      ["opencode", "2026-10-27T12:00:00Z"],
    ]);

    expect(defaultHarness(options, lastUsed)).toBe("codex");
  });

  test("is the host's first ready one when none ran, and none when nothing is ready", () => {
    expect(defaultHarness(options, new Map())).toBe("claude");
    expect(
      defaultHarness(harnessOptions(report(availability("codex", "needs-sign-in"))), new Map())
    ).toBeNull();
  });
});

describe("the model shortlist", () => {
  const claude = [
    model("default", "Default (recommended)", true),
    model("claude-opus-5-5", "Opus 5.5"),
    model("claude-opus-5", "Opus 5"),
    model("claude-fable-5-1", "Fable 5.1"),
    model("claude-sonnet-5-5", "Sonnet 5.5"),
    model("claude-sonnet-4-5", "Sonnet 4.5"),
    model("claude-haiku-4-5", "Haiku 4.5"),
  ];

  test("keeps the newest of each family, hides Claude Code's default row", () => {
    const { top, more } = shortlist("claude", claude);

    expect(top.map((m) => m.name)).toEqual(["Opus 5.5", "Fable 5.1", "Sonnet 5.5", "Haiku 4.5"]);
    expect(more.map((m) => m.name)).toEqual(["Opus 5", "Sonnet 4.5"]);
  });

  test("always shows the harness's default model", () => {
    const codex = [
      model("a", "GPT-6.1-Sol"),
      model("b", "GPT-6-Astra"),
      model("c", "GPT-6-Luna"),
      model("d", "GPT-5.6-Terra"),
      model("e", "GPT-5-Mini", true),
    ];

    expect(shortlist("codex", codex).top.map((m) => m.id)).toEqual(["a", "b", "c", "e"]);
  });

  test("the chip names the picked model, else the default, else 'Default'", () => {
    const codex = [model("a", "GPT-6.1-Sol", true)];

    expect(modelLabel("codex", codex, model("x", "GPT-6-Luna"))).toBe("GPT-6-Luna");
    expect(modelLabel("codex", codex, null)).toBe("GPT-6.1-Sol");
    expect(modelLabel("claude", claude, null)).toBe("Default");
  });
});
