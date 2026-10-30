/**
 * The Sessions header's sort menu and the Active order's tier dividers (ENG-609). The order
 * holds while the pointer is over the list, so a row never moves under it.
 */
import {
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@polaris/ui";
import { type ReactNode, useRef, useState } from "react";
import type { SessionSort } from "../../../routes/selection.ts";
import { useNav, useShellActions } from "../../../shell/hooks.ts";
import { heldOrder, TIER_LABELS, type Tier, tierRuns } from "../model/tiers.ts";

const SORT_LABELS: Readonly<Record<SessionSort, string>> = {
  active: "Active",
  newest: "Newest",
};

const SORTS: ReadonlyArray<SessionSort> = ["active", "newest"];

const isSort = (value: string): value is SessionSort => SORTS.some((s) => s === value);

export const SortMenu = () => {
  const sort = useNav((s) => s.sessionSort);
  const { setSessionSort } = useShellActions();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Sort sessions: ${SORT_LABELS[sort]}`}
        className="text-caption text-text-subtle hover:text-text-default focus-visible:text-text-default -my-1 flex shrink-0 cursor-default items-center gap-1 py-1"
      >
        {SORT_LABELS[sort]}
        <ChevronDownIcon size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => {
            if (isSort(value)) setSessionSort(value);
          }}
        >
          {SORTS.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {SORT_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface Held {
  readonly keys: ReadonlyArray<string>;
  readonly tiers: ReadonlyMap<string, Tier>;
}

export interface TieredItemsProps<T> {
  readonly items: ReadonlyArray<T>;
  readonly keyOf: (item: T) => string;
  readonly tierOf: (item: T) => Tier;
  readonly render: (items: ReadonlyArray<T>) => ReactNode;
}

/** Rows in tier order with a divider over each tier, shown only when there are two or more. */
export const TieredItems = <T,>({ items, keyOf, tierOf, render }: TieredItemsProps<T>) => {
  const [held, setHeld] = useState<Held | null>(null);

  const shown = heldOrder(items, keyOf, held?.keys ?? null);
  const tier = (item: T) => held?.tiers.get(keyOf(item)) ?? tierOf(item);
  const runs = tierRuns(shown, tier);

  const latest = useRef({ shown, tier });
  latest.current = { shown, tier };

  const hold = () => {
    const { shown: now, tier: tierNow } = latest.current;

    setHeld({ keys: now.map(keyOf), tiers: new Map(now.map((i) => [keyOf(i), tierNow(i)])) });
  };

  return (
    <div
      className="flex flex-col gap-0.5"
      onPointerEnter={hold}
      onPointerLeave={() => setHeld(null)}
    >
      {runs.length < 2
        ? render(shown)
        : runs.map((run, index) => (
            <div key={`${run.tier}-${index}`} className="flex flex-col gap-0.5">
              <p className="text-caption text-text-faint px-2 pt-1.5 pb-0.5">
                {TIER_LABELS[run.tier]} · {run.items.length}
              </p>
              {render(run.items)}
            </div>
          ))}
    </div>
  );
};
