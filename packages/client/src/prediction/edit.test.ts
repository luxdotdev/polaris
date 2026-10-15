import { expect, test } from "bun:test";
import { editModelFormat } from "./edit.ts";
import { scorePlacement, promptableModel } from "./score.ts";
import { capability, input } from "./fixtures.testing.ts";

test.each([
  ["zed-industries/zeta-2.1", "zeta-2.1"],
  ["ggml-org/ZETA_2_1-Q8_0.gguf", "zeta-2.1"],
  ["zeta2.1:latest", "zeta-2.1"],
  ["sweepai/sweep-next-edit-1.5B-Q8_0", "sweep-next-edit"],
  ["Sweep_Next_Edit:latest", "sweep-next-edit"],
  ["mellum2-12b-a2.5b", null],
  ["sweep", null],
  ["zeta-2.0", null],
] as const)("recognises %s as %s", (model, expected) => {
  expect(editModelFormat(model)).toBe(expected);

  if (expected !== null) expect(promptableModel(model)).toBe(true);
});

const report = (ram: number, models: string[]) => ({
  ...capability(ram),
  endpoints: [{ ...capability().endpoints[0]!, models }],
});

test.each([
  [32, ["sweep-next-edit", "zeta-2.1"], "sweep-next-edit"],
  [64, ["zeta-2.1", "sweep-next-edit"], "sweep-next-edit"],
  [16, ["zeta-2.1", "sweep-next-edit"], "sweep-next-edit"],
  [32, ["sweep-next-edit"], "sweep-next-edit"],
  [32, ["zeta-2.1"], "zeta-2.1"],
  [32, ["mellum2-12b-a2.5b"], "mellum2-12b-a2.5b"],
] as const)(
  "the default at %s GiB for %j is %s: Sweep whenever it is served",
  (ram, models, expected) => {
    const targets = scorePlacement({
      ...input(),
      host: null,
      client: report(ram, [...models]),
    });

    expect(targets[0]?.model).toBe(expected);
  }
);

test("defaults span all endpoints on the serving machine and edit candidates precede FIM on another side", () => {
  const client = {
    ...report(32, ["sweep-next-edit"]),
    endpoints: [
      ...report(32, ["sweep-next-edit"]).endpoints,
      ...report(32, ["zeta-2.1"]).endpoints,
    ],
  };

  expect(
    scorePlacement({ ...input(), mode: "auto", client }).map((target) => target.model)
  ).toEqual(["sweep-next-edit"]);
  expect(
    scorePlacement({
      ...input(),
      mode: "auto",
      client: report(16, ["sweep-next-edit"]),
      host: report(64, ["mellum2-12b-a2.5b"]),
    })[0]?.side
  ).toBe("client");
});

test("a chosen recognised model overrides the Sweep default and stale FIM format; Off and Pi exclusions still apply", () => {
  const selected = {
    ...input(),
    mode: "auto" as const,
    client: report(16, ["zeta-2.1", "sweep-next-edit"]),
    host: null,
    model: "zeta-2.1",
    format: "suffix" as const,
  };

  expect(scorePlacement(selected)[0]).toMatchObject({ model: "zeta-2.1", format: "zeta-2.1" });
  expect(scorePlacement({ ...selected, override: "off" })).toEqual([]);
  expect(
    scorePlacement({
      ...selected,
      client: null,
      host: {
        ...report(32, ["zeta-2.1"]),
        machine: capability(32, "zeta-2.1", "Raspberry Pi 5").machine,
      },
    })
  ).toEqual([]);
  expect(scorePlacement({ ...selected, model: "missing" })).toEqual([]);
});

test("FIM mode never prompts a next-edit model with an insertion format", () => {
  expect(
    scorePlacement({
      ...input(),
      mode: "complete",
      host: null,
      client: report(32, ["zeta-2.1"]),
      model: "zeta-2.1",
      format: "suffix",
    })
  ).toEqual([]);
});
