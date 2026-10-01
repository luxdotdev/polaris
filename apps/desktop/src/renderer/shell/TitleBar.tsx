import { Button, Kbd, PlusIcon, SearchIcon, SegmentedControl, Wordmark } from "@polaris/ui";
import type { Route } from "../../shared/api.ts";
import { useRequestedCount } from "../features/pulls/store.ts";
import { useNeedsYouCount } from "../features/needs-you/index.ts";
import { jumpCopy } from "../features/jump/copy.ts";
import { useSelection, useShellActions } from "./hooks.ts";

/**
 * The `hiddenInset` title bar (DESIGN.md, Titlebar): the lockup after the traffic
 * lights, the mode switch (⌘1–3), the jump field (K) and, outside Review, New session (⌘N).
 */
export const TitleBar = () => {
  const { mode, hostKey } = useSelection();
  const { setMode, openJump, startNewSession } = useShellActions();
  const waiting = useNeedsYouCount();
  const requested = useRequestedCount();

  const modes: ReadonlyArray<{
    readonly value: Route;
    readonly label: string;
    readonly badge?: React.ReactNode;
  }> = [
    {
      value: "orchestrate",
      label: "Orchestrate",
      badge:
        waiting > 0 ? (
          <span
            aria-label={`${waiting} need you`}
            // Paper 11U-0: 18px, radius 6, 5px sides, the needs-you wash.
            className="rounded-control bg-needs-you/12 text-micro text-needs-you-text tabular flex h-[18px] min-w-[18px] items-center justify-center px-[5px] font-medium"
          >
            {waiting}
          </span>
        ) : undefined,
    },
    {
      value: "review",
      label: "Review",
      badge:
        requested > 0 ? (
          // Paper R3: a plain count, no wash; review requests aren't sessions that need you.
          <span
            aria-label={`${requested} review requested`}
            className="text-micro text-text-subtle tabular"
          >
            {requested}
          </span>
        ) : undefined,
    },
    { value: "edit", label: "Edit" },
  ];

  return (
    <header className="app-drag border-hairline bg-surface-sunken flex h-11 shrink-0 items-center gap-4 border-b pr-3 pl-4">
      {/* The native traffic lights sit here (window.ts); fixed, never density-scaled. */}
      <span className="w-[60px] shrink-0" aria-hidden />
      <Wordmark />
      <SegmentedControl
        className="app-no-drag"
        aria-label="Mode"
        options={modes}
        value={mode}
        onValueChange={setMode}
      />
      <span className="flex-1" />
      <button
        type="button"
        onClick={openJump}
        className="app-no-drag rounded-control border-hairline bg-bg text-body text-text-faint flex h-7 w-[280px] shrink-0 cursor-default items-center gap-2 border pr-1.5 pl-2.5"
      >
        <SearchIcon size={14} />
        <span className="flex-1 truncate text-left">{jumpCopy(mode).placeholder}</span>
        <Kbd>K</Kbd>
      </button>
      {/* Review has no New session (Paper R1); ⌘N still starts one. */}
      {mode !== "review" && (
        <Button
          variant="ghost"
          className="app-no-drag text-text-default px-2.5"
          disabled={hostKey === null}
          onClick={startNewSession}
        >
          <PlusIcon size={14} />
          New session
        </Button>
      )}
    </header>
  );
};
