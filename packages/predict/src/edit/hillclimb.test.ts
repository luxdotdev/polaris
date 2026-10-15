import { describe, expect, test } from "bun:test";
import { applyEdits, guardEdits } from "./guards.ts";
import {
  hillclimbCase,
  hillclimbRequest,
  hillclimbCorpus,
  hillclimbLabels,
  hillclimbRuns,
  stateHash,
} from "./hillclimb.testing.ts";
import { editOptions, spikeEditOptions, type EditOptions } from "./options.ts";
import { editResult } from "./result.ts";
import { editWindow } from "./window.ts";

const normalized = (text: string) => text.replace(/\s/g, "");

const verdict = (id: string, output: string | null, options: EditOptions) => {
  if (output === null) return "abstain";

  const fixture = hillclimbCase(id);

  const shown = applyEdits(
    fixture.buffer,
    editResult(hillclimbRequest(id, "sweep-next-edit"), output, 0, options).edits
  );

  if (normalized(shown) === normalized(fixture.buffer)) return "abstain";

  if (
    fixture.allowed.some(
      (patch) => normalized(applyEdits(fixture.buffer, patch)) === normalized(shown)
    )
  )
    return "exact";

  return hillclimbLabels[id]?.[stateHash(shown)] ?? `unlabelled ${stateHash(shown)}`;
};

const tally = (run: readonly { id: string; output: string | null }[], options: EditOptions) => {
  const counts: Record<string, string[]> = {};

  for (const { id, output } of run) (counts[verdict(id, output, options)] ??= []).push(id);

  return counts;
};

const useful = (counts: Record<string, string[]>) => [
  ...(counts.exact ?? []),
  ...(counts.acceptable ?? []),
];

const shown = (counts: Record<string, string[]>, label: string) => counts[label] ?? [];

describe("the hill-climbed edit options on the recorded dev runs", () => {
  const before = tally(hillclimbRuns.dev.base, spikeEditOptions);
  const after = tally(hillclimbRuns.dev.final, editOptions);

  test("every shown edit is a reviewed buffer state", () => {
    expect(Object.keys(after).filter((key) => key.startsWith("unlabelled"))).toEqual([]);
  });

  test("show no dangerous edit and lose no useful case of the spike layout", () => {
    expect(shown(after, "dangerous")).toEqual([]);
    expect(useful(before).filter((id) => !useful(after).includes(id))).toEqual([]);
    expect(useful(after).length).toBeGreaterThan(useful(before).length);
  });

  test("the nearest-change fallback recovers useful cases", () => {
    const without = tally(hillclimbRuns.dev.final, { ...editOptions, nearestFallback: false });

    expect(useful(after).filter((id) => !useful(without).includes(id)).length).toBeGreaterThan(0);
  });
});

describe("the held-out runs, each made once at the end", () => {
  const before = tally(hillclimbRuns.fresh.base, spikeEditOptions);
  const after = tally(hillclimbRuns.fresh.final, editOptions);

  test("every shown edit is a reviewed buffer state", () => {
    const keys = [...Object.keys(before), ...Object.keys(after)];

    expect(keys.filter((key) => key.startsWith("unlabelled"))).toEqual([]);
  });

  test("show fewer wrong and dangerous edits than the spike layout", () => {
    expect(shown(after, "wrong").length).toBeLessThan(shown(before, "wrong").length);
    expect(shown(after, "dangerous").length).toBeLessThan(shown(before, "dangerous").length);
  });

  // The deletion-evidence guard misses a deletion whose replacement the history wrote in another form.
  test.todo("keep the exact fdd08 deletion", () => {
    expect(after.exact).toContain("fdd08");
  });
});

describe("the hill-climbed guards on every labelled state", () => {
  const blocked = (entry: (typeof hillclimbCorpus)[number], options: EditOptions) => {
    const request = hillclimbRequest(entry.id, entry.format);
    const window = { ...editWindow(request, options), from: 0, to: request.buffer.length };

    return guardEdits(request, window, entry.edits, options).edits.length === 0;
  };

  const newlyBlocked = (label: string) =>
    hillclimbCorpus
      .filter((entry) => entry.label === label)
      .filter((entry) => blocked(entry, editOptions) && !blocked(entry, spikeEditOptions));

  test("never suppress a useful state the spike guards showed", () => {
    expect(newlyBlocked("exact").map((entry) => entry.id)).toEqual([]);
    expect(newlyBlocked("acceptable").map((entry) => entry.id)).toEqual([]);
  });

  const guardFlags = [
    "novelNames",
    "declarationRenames",
    "removedNames",
    "deletionEvidence",
    "relevance",
    "duplicates",
    "selfReference",
  ] as const;

  for (const flag of guardFlags)
    test(`${flag} alone suppresses a dangerous state`, () => {
      const without = { ...editOptions, [flag]: false };

      const caught = hillclimbCorpus.filter(
        (entry) =>
          entry.label === "dangerous" && blocked(entry, editOptions) && !blocked(entry, without)
      );

      expect(caught.length).toBeGreaterThan(0);
    });
});
