/**
 * The tabs over Review's centre pane (Paper R9 AMW-0): each label with its figure, the
 * chosen one on `fill-selected`, and the jump to Changes trailing. ⌘⇧[ / ⌘⇧] cycle them.
 */
import { cn, Kbd, Tooltip, TooltipContent, TooltipTrigger } from "@polaris/ui";
import { type TabId, TAB_LABELS } from "../model/tabs.ts";

export interface TabBarProps {
  readonly tabs: ReadonlyArray<TabId>;
  readonly current: TabId;
  readonly figures: Readonly<Partial<Record<TabId, string>>>;
  /** What a tab's tooltip says beyond its label ("9 files, 0 viewed"). */
  readonly hints: Readonly<Partial<Record<TabId, string>>>;
  /** A tab whose content changed since the last review ("updated", "3 new"). */
  readonly news: Readonly<Partial<Record<TabId, string>>>;
  readonly onPick: (tab: TabId) => void;
  /** "Review changes", "Review 2 new commits"; null hides the jump (on Changes). */
  readonly jumpLabel: string | null;
}

const NEXT = "⇧⌘]";

const PREVIOUS = "⇧⌘[";

const keyTo = (tabs: ReadonlyArray<TabId>, current: TabId, tab: TabId) => {
  const from = tabs.indexOf(current);
  const to = tabs.indexOf(tab);

  if ((from + 1) % tabs.length === to) return NEXT;

  return (to + 1) % tabs.length === from ? PREVIOUS : null;
};

export const TabBar = ({ tabs, current, figures, hints, news, onPick, jumpLabel }: TabBarProps) => (
  <div
    role="tablist"
    aria-label="Review"
    data-testid="review-tabs"
    className="border-hairline px-panel flex h-10 shrink-0 items-center gap-1 border-b"
  >
    {tabs.map((tab) => {
      const key = keyTo(tabs, current, tab);
      const hint = [TAB_LABELS[tab], hints[tab]].filter((p) => p !== undefined).join(" · ");

      return (
        <Tooltip key={tab}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="tab"
              id={`review-tab-${tab}`}
              aria-selected={tab === current}
              aria-controls={`review-panel-${tab}`}
              data-testid={`review-tab-${tab}`}
              onClick={() => onPick(tab)}
              className={cn(
                "rounded-control h-tree-row px-row-x flex shrink-0 cursor-default items-center gap-1.5",
                tab === current ? "bg-fill-selected" : "hover:bg-fill-hover"
              )}
            >
              <span
                className={cn(
                  "text-body font-medium",
                  tab === current ? "text-text-strong" : "text-text-subtle"
                )}
              >
                {TAB_LABELS[tab]}
              </span>
              {figures[tab] !== undefined && (
                <span className="text-caption text-text-subtle tabular">{figures[tab]}</span>
              )}
              {news[tab] !== undefined && (
                <span className="text-caption text-text-default">{news[tab]}</span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-2">
            {hint}
            {key !== null && <Kbd>{key}</Kbd>}
          </TooltipContent>
        </Tooltip>
      );
    })}
    <span className="flex-1" />
    {jumpLabel !== null && (
      <button
        type="button"
        data-testid="review-jump-changes"
        onClick={() => onPick("changes")}
        className="rounded-control h-tree-row pr-row-x bg-fill-selected text-body text-text-strong hover:bg-fill-selected/70 gap-gap flex shrink-0 cursor-default items-center pl-3 font-medium"
      >
        {jumpLabel} →{current === "overview" && <Kbd>{NEXT}</Kbd>}
      </button>
    )}
  </div>
);
