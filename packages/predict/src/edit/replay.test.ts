import { expect, test } from "bun:test";
import { PredictedEdit } from "@polaris/protocol";
import { Schema } from "effect";
import { fixtures, fixtureRequest } from "./fixtures.testing.ts";
import { applyEdits } from "./guards.ts";
import { editResult } from "./result.ts";
import goldens from "./fixtures/exact.json";

const exact = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Array(PredictedEdit)))(
  goldens
);

const normalized = (text: string) => text.replace(/\s/g, "");

for (const fixture of fixtures) {
  for (const recorded of fixture.outputs) {
    test(`${recorded.format} ${fixture.id}: recorded ${recorded.label}`, () => {
      const result = editResult(fixtureRequest(fixture, recorded.format), recorded.output);
      const actual = applyEdits(fixture.buffer, result.edits);

      if (recorded.label === "exact") {
        expect(result.edits).toEqual(exact[fixture.id]!);
        expect(result.suppressed).toEqual([]);
        const allowed = fixture.allowed.map((patch) => applyEdits(fixture.buffer, patch));
        expect(allowed.map(normalized)).toContain(normalized(actual));

        if (fixture.id !== "rf01") expect(allowed).toContain(actual);
        else expect(actual).not.toBe(applyEdits(fixture.buffer, fixture.expected));
      } else if (recorded.label === "dangerous") {
        expect(result.edits).toEqual([]);
        expect(result.suppressed.length).toBeGreaterThan(0);
      } else if (recorded.label === "abstain") expect(result.edits).toEqual([]);
      else expect(result.edits.length).toBeGreaterThan(0);
    });
  }
}
