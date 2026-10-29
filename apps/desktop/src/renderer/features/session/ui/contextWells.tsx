/**
 * The context card's wells (Paper X-F 02): usage (the figure, the prompt cache, the waffle and
 * its legend) and contents (Conversation / MCP / Skills / Memory, one at a time).
 */
import { cn, Kicker, SegmentedControl } from "@polaris/ui";
import { type CSSProperties, type ReactNode, useState } from "react";
import {
  type ContextCard as Card,
  rowShare,
  rowTokens,
  type Segment,
  type SessionSpend,
} from "../model/context.ts";
import type { Detail } from "../model/contextDetails.ts";
import { formatTokens } from "../model/meta.ts";

/** rule/context-categories: the conversation (and a total-only count) takes the Harness hue. */
const COLOUR = new Map([
  ["conversation", "var(--hue)"],
  ["used", "var(--hue)"],
  ["system", "var(--color-context-system)"],
  ["tools", "var(--color-context-tools)"],
  ["mcp", "var(--color-context-mcp)"],
  ["skills", "var(--color-context-skills)"],
  ["memory", "var(--color-context-memory)"],
]);

const colourOf = (key: string) => COLOUR.get(key) ?? "var(--color-text-subtle)";

const FREE = "bg-[light-dark(#00000014,#ffffff12)]";

const RESERVE = "shadow-[inset_0_0_0_1px_light-dark(#00000033,#ffffff38)]";

/** A cell or swatch: free as a faint track, the reserve outlined, a category in its colour. */
interface Swatch {
  readonly className?: string;
  readonly style?: CSSProperties;
}

const swatch = (key: string, dim: boolean): Swatch => {
  if (key === "free") return { className: FREE };

  if (key === "reserve") return { className: RESERVE };
  const colour = colourOf(key);

  return {
    style: {
      backgroundColor: dim ? `color-mix(in srgb, ${colour} 35%, transparent)` : colour,
    },
  };
};

/** The legend row under the pointer, else the contents tab: the waffle lights that category. */
export const useContextFocus = (card: Card | null) => {
  const tabs = (card?.legend ?? []).filter((s) => opens(s));
  const [picked, setTab] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const tab = tabs.find((s) => s.key === picked) ?? tabs[0] ?? null;

  return { tabs, tab, setTab, hover, setHover, focus: hover ?? tab?.key ?? null };
};

export type ContextFocus = ReturnType<typeof useContextFocus>;

const opens = (s: Segment) => s.details.rows.length > 0 || s.details.footnote !== null;

const Waffle = ({ card, focus }: { readonly card: Card; readonly focus: string | null }) => (
  <div className="grid grid-cols-[repeat(25,12px)] gap-0.5" aria-hidden data-testid="context-meter">
    {card.cells.map((key, i) => {
      const look = swatch(key, focus !== null && focus !== key);

      return (
        // Cells are positional: one cellTokens each, in window order.
        <span key={i} className={cn("size-3", look.className)} style={look.style} />
      );
    })}
  </div>
);

const LegendRow = ({
  segment,
  window,
  focused,
  focus,
}: {
  readonly segment: Segment;
  readonly window: number;
  readonly focused: boolean;
  readonly focus: ContextFocus;
}) => {
  const look = swatch(segment.key, false);
  const tab = opens(segment);

  const line = (
    <>
      <span className={cn("size-gap shrink-0", look.className)} style={look.style} />
      <Kicker className={cn("min-w-0 flex-1 truncate", focused && "text-text-strong")}>
        {segment.short}
      </Kicker>
      <span
        className={cn(
          "text-caption tabular shrink-0",
          focused ? "text-text-strong font-medium" : "text-text-default"
        )}
      >
        {rowTokens(segment.tokens)}
      </span>
      <span className="text-text-subtle tabular w-7 shrink-0 text-right font-mono text-[10px] leading-[14px]">
        {rowShare(segment.tokens, window)}
      </span>
    </>
  );

  const className = cn(
    "flex h-5 min-w-0 items-center gap-1.5 rounded-[2px] px-1 text-left",
    focused && "bg-fill-hover"
  );

  const pointer = {
    onPointerEnter: () => focus.setHover(segment.key),
    onPointerLeave: () => focus.setHover(null),
  };

  return tab ? (
    <button
      type="button"
      className={cn(className, "focus-visible:outline-starlight cursor-default outline-none")}
      aria-pressed={focus.tab?.key === segment.key}
      data-testid="context-row"
      data-key={segment.key}
      onClick={() => focus.setTab(segment.key)}
      onFocus={() => focus.setHover(segment.key)}
      onBlur={() => focus.setHover(null)}
      {...pointer}
    >
      {line}
    </button>
  ) : (
    <div className={className} data-testid="context-row" data-key={segment.key} {...pointer}>
      {line}
    </div>
  );
};

const CacheColumn = ({ spend }: { readonly spend: SessionSpend }) => {
  const share = spend.cacheShare;

  return (
    <div className="flex w-28 shrink-0 flex-col gap-1" data-testid="context-cache">
      <Kicker>
        Prompt cache
        {share === null ? null : (
          <>
            <br />
            {share}% hit
          </>
        )}
      </Kicker>
      {spend.cost === null ? null : (
        <span className="text-heading text-text-strong tabular font-medium">{spend.cost}</span>
      )}
      {share === null ? null : (
        <>
          <span className="flex h-1 w-full gap-px" aria-hidden>
            <span className="bg-text-default h-full" style={{ width: `${share}%` }} />
            <span className="h-full flex-1 bg-[light-dark(#0000001f,#ffffff1f)]" />
          </span>
          <Kicker className="font-regular">
            {formatTokens(spend.cached)} cached
            <br />
            {formatTokens(spend.fresh)} new
          </Kicker>
        </>
      )}
    </div>
  );
};

export interface UsageWellProps {
  readonly card: Card;
  /** "17% full · Opus 5.5", then "as of turn 24". */
  readonly kicker: readonly [string, string | null];
  readonly spend: SessionSpend | null;
  readonly focus: ContextFocus;
  /** The latest compaction, the totals-only and unknown-window notes. */
  readonly notes: ReactNode;
}

export const UsageWell = ({ card, kicker, spend, focus, notes }: UsageWellProps) => (
  <div className="flex flex-col gap-3.5 px-[18px] py-3.5" data-testid="context-usage">
    <div className="flex gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Kicker>Context used</Kicker>
        <div className="flex items-baseline gap-1.5">
          <span className="text-text-strong tabular text-[34px] leading-10 tracking-[-0.02em]">
            {formatTokens(card.used)}
          </span>
          <span className="text-body text-text-subtle truncate">
            {card.window === null ? "tokens" : `/ ${formatTokens(card.window)} tokens`}
          </span>
        </div>
        <Kicker>
          {kicker[0]}
          {kicker[1] === null ? null : (
            <>
              <br />
              {kicker[1]}
            </>
          )}
        </Kicker>
      </div>
      {spend === null || (spend.cacheShare === null && spend.cost === null) ? null : (
        <>
          <span className="w-0 shrink-0 self-stretch border-l border-dashed border-[light-dark(#0000001f,#ffffff1f)]" />
          <CacheColumn spend={spend} />
        </>
      )}
    </div>
    {card.window === null ? null : <Waffle card={card} focus={focus.focus} />}
    {card.window === null ? null : (
      <div className="-mx-1 grid grid-cols-2 gap-x-2 gap-y-[3px]" data-testid="context-breakdown">
        {card.legend.map((segment) => (
          <LegendRow
            key={segment.key}
            segment={segment}
            window={card.window ?? 1}
            focused={focus.focus === segment.key}
            focus={focus}
          />
        ))}
      </div>
    )}
    {notes}
  </div>
);

const DASHES = 16;

/** A row's share of its category's largest row, as a dotted pixel bar. */
const DotBar = ({ share, colour }: { readonly share: number; readonly colour: string }) => {
  const lit = Math.max(1, Math.round(share * DASHES));

  return (
    <svg
      width="62"
      height="8"
      viewBox="0 0 62 8"
      className="[shape-rendering:crispEdges]"
      aria-hidden
    >
      {Array.from({ length: DASHES }, (_, i) => (
        <rect
          key={i}
          x={i * 4}
          width="2"
          height="8"
          fill={i < lit ? colour : "light-dark(#00000014, #ffffff14)"}
        />
      ))}
    </svg>
  );
};

const ROW_LINE = "border-t border-dashed border-[light-dark(#00000014,#ffffff14)]";

const DetailRow = ({
  detail,
  max,
  colour,
}: {
  readonly detail: Detail;
  readonly max: number;
  readonly colour: string;
}) => (
  <li className={cn("flex h-[30px] shrink-0 items-center gap-2.5 first:border-t-0", ROW_LINE)}>
    <span
      className={cn(
        "text-caption max-w-[45%] min-w-0 shrink-0 truncate",
        detail.mono ? "text-text-default font-mono" : "text-text-default"
      )}
    >
      {detail.label}
    </span>
    <Kicker className="min-w-0 flex-1 truncate">{detail.note}</Kicker>
    <DotBar share={max === 0 ? 0 : detail.tokens / max} colour={colour} />
    <span className="text-caption text-text-default tabular w-9 shrink-0 text-right">
      {rowTokens(detail.tokens)}
    </span>
  </li>
);

/** "4 MCP servers · 11.9k · 6% of window". */
const contentsLine = (segment: Segment, window: number | null) =>
  [
    segment.details.count === null ? segment.label : `${segment.details.count} ${segment.short}`,
    rowTokens(segment.tokens),
    window === null ? null : `${rowShare(segment.tokens, window)} of window`,
  ]
    .filter((p) => p !== null)
    .join(" · ");

export const ContentsWell = ({
  card,
  focus,
}: {
  readonly card: Card;
  readonly focus: ContextFocus;
}) => {
  const { tab, tabs } = focus;

  if (tab === null) return null;
  const { rows, footnote } = tab.details;
  const max = Math.max(0, ...rows.map((r) => r.tokens));

  return (
    <div className="gap-row-pad flex flex-col px-[18px] pt-3.5 pb-3" data-testid="context-details">
      <div className="flex flex-col gap-0.5">
        <span className="text-body text-text-default font-medium">Contents</span>
        <Kicker className="truncate">{contentsLine(tab, card.window)}</Kicker>
      </div>
      {tabs.length < 2 ? null : (
        <SegmentedControl
          aria-label="Contents"
          variant="fill"
          pill
          className="w-auto self-start"
          value={tab.key}
          onValueChange={focus.setTab}
          options={tabs.map((s) => ({
            value: s.key,
            label: <span className="px-2.5 whitespace-nowrap">{s.short}</span>,
          }))}
        />
      )}
      <ul className="flex flex-col">
        {rows.map((d) => (
          <DetailRow key={d.key} detail={d} max={max} colour={colourOf(tab.key)} />
        ))}
        {footnote === null ? null : (
          <li className={cn("pt-gap flex items-center", rows.length > 0 && ROW_LINE)}>
            <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
              {footnote.text}
            </span>
            {footnote.tokens === null ? null : (
              <span className="text-caption text-text-subtle tabular shrink-0">
                {rowTokens(footnote.tokens)}
              </span>
            )}
          </li>
        )}
      </ul>
    </div>
  );
};
