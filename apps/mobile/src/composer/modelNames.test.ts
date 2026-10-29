import { describe, expect, test } from "bun:test";
import { Model, ModelId } from "@polaris/protocol";
import { modelsFor, rememberModels } from "./modelNames.ts";
import { currentModel, modelLabel } from "./modelSheet.ts";

const opus = new Model({
  id: ModelId.make("claude-opus-5-5"),
  name: "Opus 5",
  description: null,
  efforts: ["low", "medium", "high"],
  defaultEffort: null,
  isDefault: true,
});

/** The thread's chip before its own ask returns, as useModelSheet words it. */
const chip = (hostId: string, id: string) =>
  modelLabel(currentModel(modelsFor(hostId, "claude", []), ModelId.make(id)), id);

describe("the model chip across the hand-off from new session to thread", () => {
  test("names the Model the new session listed, never its raw id", () => {
    rememberModels("studio", "claude", [opus]);

    expect(chip("studio", "claude-opus-5-5")).toBe("Opus 5");
  });

  test("another Host's list names nothing on this one", () => {
    rememberModels("studio", "claude", [opus]);

    expect(chip("rpi", "claude-opus-5-5")).toBe("claude-opus-5-5");
  });

  test("a Host that lists nothing keeps the list it gave before", () => {
    rememberModels("mini", "claude", [opus]);
    rememberModels("mini", "claude", []);

    expect(chip("mini", "claude-opus-5-5")).toBe("Opus 5");
  });
});
