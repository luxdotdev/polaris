import { describe, expect, test } from "bun:test";
import type { HarnessKind } from "@polaris/protocol";
import { chromeRecord } from "../preview/chrome.ts";
import { starChart } from "./chart.ts";
import { plainFacts } from "./facts.ts";
import { buildRail } from "./rail.ts";
import { type Segment, segments, type StripTone } from "./strip.ts";
import { WAVE_BAR, waveBar } from "./waves.ts";

const seg = (key: string, tone: StripTone, harness: HarnessKind | null = null): Segment => ({
  key,
  title: key,
  word: tone,
  tone,
  harness,
});

const tones = (bar: ReturnType<typeof waveBar>) =>
  bar.map((w) =>
    w.parts.map((p) => `${p.tone}${p.harness === null ? "" : `:${p.harness}`}×${p.count}`)
  );

describe("the wave bar", () => {
  test("folds the Chrome redesign graph into one segment per wave, by state", () => {
    const record = chromeRecord();

    const waves = new Map(
      starChart(record.constellation.tasks).stars.map((s) => [s.id, s.wave] as const)
    );

    const bar = waveBar(segments(buildRail(record, plainFacts()).tasks), waves);

    expect(bar.map((w) => w.wave)).toEqual([1, 2, 3, 4, 5]);
    expect(tones(bar)[0]).toEqual(["accepted×6"]);
    expect(tones(bar)[1]?.[0]).toMatch(/^working/);
    expect(tones(bar)[4]).toEqual(["waiting×1"]);
  });

  test("orders a wave's states the same way whatever order its Tasks come in", () => {
    const bar = waveBar(
      [seg("a", "waiting"), seg("b", "needs-you"), seg("c", "accepted"), seg("d", "review")],
      new Map()
    );

    expect(tones(bar)).toEqual([["accepted×1", "review×1", "needs-you×1", "waiting×1"]]);
  });

  test("keeps working Tasks of different Harnesses apart, and merges the same one", () => {
    const bar = waveBar(
      [seg("a", "working", "claude"), seg("b", "working", "codex"), seg("c", "working", "claude")],
      new Map()
    );

    expect(tones(bar)).toEqual([["working:claude×2", "working:codex×1"]]);
  });

  test("fills each segment exactly, gaps included, wider parts for more Tasks", () => {
    const [wave] = waveBar(
      [seg("a", "accepted"), seg("b", "accepted"), seg("c", "accepted"), seg("d", "failed")],
      new Map()
    );

    const parts = wave?.parts ?? [];
    const used = parts.reduce((sum, p) => sum + p.width, 0) + WAVE_BAR.partGap * (parts.length - 1);

    expect(used).toBe(wave?.width ?? -1);
    expect(parts[0]?.width ?? 0).toBeGreaterThan(parts[1]?.width ?? 0);
  });

  test("narrows segments to fit many waves in the row", () => {
    const many = Array.from({ length: 12 }, (_, n) => seg(`T${n}`, "accepted"));
    const bar = waveBar(many, new Map(many.map((s, n) => [s.key, n + 1])));
    const total = bar.reduce((sum, w) => sum + w.width, 0) + WAVE_BAR.gap * (bar.length - 1);

    expect(bar).toHaveLength(12);
    expect(total).toBeLessThanOrEqual(WAVE_BAR.budget);
  });
});
