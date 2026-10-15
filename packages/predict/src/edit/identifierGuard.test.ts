import { expect, test } from "bun:test";
import { hardeningCases, hardeningRequest, hardeningRuns } from "./hardening.testing.ts";
import { unsafeIdentifiers } from "./identifierGuard.ts";
import { parseRegions } from "./parse.ts";
import { buildEditPrompt } from "./prompt.ts";
import { applyEdits } from "./guards.ts";
import { diffEdits } from "./diff.ts";

for (const [id, behavior] of [
  ["im04", "replacing an unrelated definition"],
  ["dd03", "clashing with an imported binding"],
  ["dd06", "inventing a declaration rename"],
  ["rf06", "propagating an unresolved name"],
  ["hrf06", "renaming an unrelated namespace"],
]) {
  test(`identifier restraint independently rejects ${behavior}`, () => {
    const fixture = hardeningCases.find((item) => item.id === id)!;

    const run = hardeningRuns.find(
      (item) => item.format === "sweep-next-edit" && item.split === "dev"
    )!;

    const recorded = run.outputs.find((item) => item.id === id)!;
    const input = hardeningRequest(fixture, run.format);
    const built = buildEditPrompt(input);
    const { regions } = parseRegions(input, built.window, recorded.output, built.stop);
    const after = applyEdits(input.buffer, regions);
    expect(unsafeIdentifiers(input, after, diffEdits(input.buffer, after))).toBe(true);
  });
}
