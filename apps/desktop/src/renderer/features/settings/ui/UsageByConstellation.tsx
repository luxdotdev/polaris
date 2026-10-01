/**
 * Usage → By Constellation (spec §9): each Constellation's tokens split Lead / workers, its
 * cost and wall-clock time; a row opens to its Tasks. Computed when shown, from the buckets.
 */
import { ChevronDownIcon, ChevronRightIcon } from "@polaris/ui";
import { useMemo, useState } from "react";
import { useAllConstellations } from "../../sessions/source.ts";
import { ConstellationMark } from "../../sessions/glyphs.tsx";
import { byConstellation, type ConstellationSpend, duration } from "../model/byConstellation.ts";
import { type Bucket, compactTokens, costLabel, type Estimator } from "../model/usage.ts";
import { Group } from "./parts.tsx";

const NUM = "text-label font-regular tabular shrink-0 text-right";

const Row = ({ spend }: { readonly spend: ConstellationSpend }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="usage-constellation"
        className="px-panel hover:bg-fill-hover flex h-9 shrink-0 cursor-default items-center gap-1.5 text-left"
      >
        {open ? (
          <ChevronDownIcon size={10} className="text-text-faint shrink-0" />
        ) : (
          <ChevronRightIcon size={10} className="text-text-faint shrink-0" />
        )}
        <ConstellationMark size={14} />
        <span className="text-label text-text-default min-w-0 flex-1 truncate">{spend.name}</span>
        <span className={`${NUM} text-text-default w-[80px]`}>
          {compactTokens(spend.lead.tokens)}
        </span>
        <span className={`${NUM} text-text-default w-[80px]`}>
          {compactTokens(spend.workers.tokens)}
        </span>
        <span className={`${NUM} text-text-subtle w-[90px]`}>{costLabel(spend.total.cost)}</span>
        <span className={`${NUM} text-text-subtle w-[70px]`}>{duration(spend.durationMs)}</span>
      </button>
      {open
        ? spend.tasks.map((t) => (
            <div
              key={t.taskId}
              className="px-panel flex h-8 shrink-0 items-center gap-1.5 pl-[42px]"
            >
              <span className="text-code-inline text-text-subtle w-7 shrink-0 font-mono">
                {t.taskId}
              </span>
              <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
                {t.title}
                {t.attempts > 1 ? ` · ${t.attempts} attempts` : ""}
              </span>
              <span className="w-[80px] shrink-0" />
              <span className={`${NUM} text-caption text-text-subtle w-[80px]`}>
                {compactTokens(t.tokens)}
              </span>
              <span className={`${NUM} text-caption text-text-subtle w-[90px]`}>
                {costLabel(t.cost)}
              </span>
              <span className="w-[70px] shrink-0" />
            </div>
          ))
        : null}
    </>
  );
};

export const UsageByConstellation = ({
  buckets,
  now,
  estimate,
}: {
  readonly buckets: ReadonlyArray<Bucket>;
  readonly now: number;
  readonly estimate: Estimator;
}) => {
  const views = useAllConstellations();

  const rows = useMemo(
    () => byConstellation({ buckets, views: Object.values(views).flat(), now, estimate }),
    [buckets, views, now, estimate]
  );

  if (rows.length === 0) return null;

  return (
    <div data-testid="usage-by-constellation">
      <Group label="By constellation">
        <div className="bg-surface-sunken h-row px-panel text-caption text-text-subtle flex shrink-0 items-center gap-1.5">
          <span className="flex-1 pl-[26px]">Constellation</span>
          <span className="w-[80px] shrink-0 text-right">Lead</span>
          <span className="w-[80px] shrink-0 text-right">Workers</span>
          <span className="w-[90px] shrink-0 text-right">Cost</span>
          <span className="w-[70px] shrink-0 text-right">Time</span>
        </div>
        {rows.map((spend) => (
          <Row key={spend.id} spend={spend} />
        ))}
      </Group>
    </div>
  );
};
