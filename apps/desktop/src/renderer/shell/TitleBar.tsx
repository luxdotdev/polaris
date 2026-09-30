import { Badge, Button, Kbd, PlusIcon, SearchIcon, SegmentedControl, Wordmark } from "@polaris/ui";
import type { Route } from "../../shared/api.ts";
import { needsYou } from "../routes/topBar.ts";
import { useApp, useSelection, useShellActions } from "./hooks.ts";

/** Sessions that need you, across every Host: the Orchestrate badge. */
const useNeedsYouCount = () =>
  useApp((s) => {
    let n = 0;

    for (const model of Object.values(s.hostModels)) {
      for (const entry of model.sessions.values()) if (needsYou(entry)) n++;
    }

    return n;
  });

/**
 * The `hiddenInset` title bar (DESIGN.md, Titlebar): the lockup after the traffic
 * lights, the mode switch (⌘1–3), the jump field (K) and New session (⌘N).
 */
export const TitleBar = () => {
  const { mode, workspaceId } = useSelection();
  const { setMode, openJump, startNewSession } = useShellActions();
  const waiting = useNeedsYouCount();

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
          <Badge tone="needs-you" size="count" aria-label={`${waiting} need you`}>
            {waiting}
          </Badge>
        ) : undefined,
    },
    { value: "review", label: "Review" },
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
        <span className="flex-1 truncate text-left">Jump to a session or workspace</span>
        <Kbd>K</Kbd>
      </button>
      <Button
        variant="ghost"
        className="app-no-drag text-text-default px-2.5"
        disabled={workspaceId === null}
        onClick={startNewSession}
      >
        <PlusIcon size={14} />
        New session
      </Button>
    </header>
  );
};
