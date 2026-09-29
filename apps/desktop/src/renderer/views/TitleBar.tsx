import { SegmentedControl, Wordmark } from "@polaris/ui";
import type { Route } from "../../shared/api.ts";
import { useApp, useConnection } from "./hooks.ts";

const MODES: ReadonlyArray<{ readonly value: Route; readonly label: string }> = [
  { value: "orchestrate", label: "Orchestrate" },
  { value: "review", label: "Review" },
  { value: "edit", label: "Edit" },
];

/** The `hiddenInset` title bar: a drag region with the wordmark and the mode switch. */
export const TitleBar = () => {
  const route = useApp((s) => s.route);
  const { setRoute } = useConnection();

  return (
    <header className="app-drag border-hairline bg-surface-sunken flex h-[52px] shrink-0 items-center gap-4 border-b pl-[88px]">
      <Wordmark />
      <SegmentedControl
        className="app-no-drag"
        variant="mode"
        aria-label="Mode"
        options={MODES}
        value={route}
        onValueChange={setRoute}
      />
    </header>
  );
};
