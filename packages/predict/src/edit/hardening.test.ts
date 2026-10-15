import { expect, test } from "bun:test";
import { applyEdits } from "./guards.ts";
import { editResult } from "./result.ts";
import { hardeningCases, hardeningRequest, hardeningRuns } from "./hardening.testing.ts";

const normalized = (text: string) => text.replace(/\s/g, "");

for (const run of hardeningRuns) {
  test(`${run.format} ${run.split}: every frozen case has one reviewed response`, () => {
    const ids = hardeningCases
      .filter((fixture) => fixture.split === run.split)
      .map((fixture) => fixture.id)
      .sort();

    expect(run.outputs.map((output) => output.id).sort()).toEqual(ids);
    expect(Object.keys(run.labels).sort()).toEqual(ids);
  });

  for (const recorded of run.outputs) {
    const fixture = hardeningCases.find((item) => item.id === recorded.id)!;
    const label = run.labels[recorded.id]!;

    test(`${run.format} ${run.split} ${recorded.id}: ${label.label}`, () => {
      const result = editResult(hardeningRequest(fixture, run.format), recorded.output);

      if (label.label === "dangerous") {
        expect(result.edits).toEqual([]);
        expect(result.suppressed.length).toBeGreaterThan(0);
      } else if (label.label === "exact") {
        expect(result.suppressed).toEqual([]);
        expect(
          fixture.allowed.map((patch) => normalized(applyEdits(fixture.buffer, patch)))
        ).toContain(normalized(applyEdits(fixture.buffer, result.edits)));
      } else if (label.label === "acceptable") {
        if (!label.edits) throw new Error("Acceptable output needs reviewed edits");

        expect(result.suppressed).toEqual([]);
        expect(result.edits).toEqual(label.edits);
        expect(result.edits.length).toBeGreaterThan(0);
      } else if (label.label === "abstain") expect(result.edits).toEqual([]);
      else {
        // Rejected additions may remain visible; keep them distinct from reviewed useful edits.
        expect(
          fixture.allowed.map((patch) => normalized(applyEdits(fixture.buffer, patch)))
        ).not.toContain(normalized(applyEdits(fixture.buffer, result.edits)));
      }
    });
  }
}
