/**
 * The tabs over Review's centre pane (Paper R9 AMW-0, X-G): pill tabs in a track on the
 * ground, each label with its figure, the chosen one on `fill-selected`, and the jump to
 * Changes trailing as a pill. ⌘⇧[ / ⌘⇧] cycle them.
 */
import { cn, Kbd, Tooltip, TooltipContent, TooltipTrigger } from "@polaris/ui";
import { type TabId, TAB_LABELS } from "../model/tabs.ts";
import { commandShortcut } from "../../../../../shared/keymap.ts";

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

const next = () => commandShortcut("review.nextTab");

const previous = () => commandShortcut("review.previousTab");

const keyTo = (tabs: ReadonlyArray<TabId>, current: TabId, tab: TabId) => {
  const from = tabs.indexOf(current);
  const to = tabs.indexOf(tab);

  if ((from + 1) % tabs.length === to) return next();

  return (to + 1) % tabs.length === from ? previous() : null;
};

export const TabBar = ({ tabs, current, figures, hints, news, onPick, jumpLabel }: TabBarProps) => (
  <div
    role="tablist"
    aria-label="Review"
    data-testid="review-tabs"
    className="px-panel gap-gap flex shrink-0 items-center pb-3"
  >
    <div className="bg-ground flex min-w-0 gap-0.5 overflow-hidden rounded-full p-[3px]">
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
                  "flex h-[30px] shrink-0 cursor-default items-center gap-1.5 rounded-full px-3.5",
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
    </div>
    <span className="flex-1" />
    {jumpLabel !== null && (
      <button
        type="button"
        data-testid="review-jump-changes"
        onClick={() => onPick("changes")}
        className="bg-fill-selected text-body text-text-strong hover:bg-fill-selected/70 gap-gap flex h-[30px] shrink-0 cursor-default items-center rounded-full pr-1.5 pl-3 font-medium"
      >
        {jumpLabel} →{current === "overview" && <Kbd>{next()}</Kbd>}
      </button>
    )}
  </div>
);
