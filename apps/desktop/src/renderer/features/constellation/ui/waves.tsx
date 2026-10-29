/**
 * The sidebar row's glance (Paper X-H, compact): one segment per wave split by state, then
 * "accepted/total" and the hand when a Task needs you.
 */
import { PixelHandIcon } from "@polaris/ui";
import { useMemo } from "react";
import { useFacts, useLeadConstellation } from "../hooks.ts";
import { starChart } from "../model/chart.ts";
import { progressOf } from "../model/glance.ts";
import { buildRail, segments } from "../model/index.ts";
import { WAVE_BAR, type WaveSegment, waveBar } from "../model/waves.ts";
import { toneFill } from "./stars.tsx";

/** The graph's chart, rows and states for one Lead, folded once per change. */
export const useGlance = (hostKey: string, leadSessionId: string) => {
  const record = useLeadConstellation(hostKey, leadSessionId);
  const facts = useFacts(record);

  return useMemo(() => {
    if (record === null) return null;
    const rail = buildRail(record, facts);

    return {
      record,
      rail,
      chart: starChart(record.constellation.tasks),
      segments: segments(rail.tasks),
    };
  }, [record, facts]);
};

const HEIGHT = 6;

const Segment = ({ segment, x }: { readonly segment: WaveSegment; readonly x: number }) => {
  let at = x;

  return (
    <g data-wave={segment.wave}>
      {segment.parts.map((p) => {
        const left = at;

        at += p.width + WAVE_BAR.partGap;

        return p.tone === "waiting" ? (
          <rect
            key={`${p.tone}${p.harness ?? ""}`}
            x={left + 0.5}
            y={1.5}
            width={p.width - 1}
            height={HEIGHT - 1}
            fill="none"
            stroke="var(--color-text-faint)"
            data-tone={p.tone}
          />
        ) : (
          <rect
            key={`${p.tone}${p.harness ?? ""}`}
            x={left}
            y={1}
            width={p.width}
            height={HEIGHT}
            fill={p.tone === "review" ? "var(--color-text-default)" : toneFill(p.tone, p.harness)}
            data-tone={p.tone}
          />
        );
      })}
    </g>
  );
};

/** One segment per wave, its Tasks' states inside it; the counts beside it carry the words. */
export const WaveBar = ({
  hostKey,
  leadSessionId,
}: {
  readonly hostKey: string;
  readonly leadSessionId: string;
}) => {
  const glance = useGlance(hostKey, leadSessionId);

  const bar = useMemo(
    () =>
      glance === null
        ? []
        : waveBar(glance.segments, new Map(glance.chart.stars.map((s) => [s.id, s.wave] as const))),
    [glance]
  );

  if (glance === null || bar.length === 0) return null;
  const p = progressOf(glance.segments);
  const width = bar.reduce((sum, w) => sum + w.width, 0) + WAVE_BAR.gap * (bar.length - 1);
  const xs = bar.map((_, n) => bar.slice(0, n).reduce((sum, w) => sum + w.width + WAVE_BAR.gap, 0));

  return (
    <span className="flex min-w-0 items-center gap-2" data-testid="wave-bar">
      <svg
        width={width}
        height={HEIGHT + 2}
        aria-hidden
        className="shrink-0 [shape-rendering:crispEdges]"
      >
        {bar.map((segment, n) => (
          <Segment key={segment.wave} segment={segment} x={xs[n] ?? 0} />
        ))}
      </svg>
      <span className="text-text-subtle tabular shrink-0 font-mono text-[11px] leading-[14px]">
        {p.accepted}/{p.total}
        <span className="sr-only"> accepted</span>
      </span>
      {p.needsYou === 0 ? null : (
        <span className="-ml-0.5 flex shrink-0" role="img" aria-label={`${p.needsYou} needs you`}>
          <PixelHandIcon size={10} className="text-needs-you" />
        </span>
      )}
    </span>
  );
};
