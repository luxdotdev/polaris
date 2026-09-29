import type { Route } from "../../shared/api.ts";
import { useApp, useConnection } from "./hooks.ts";

const MODES: ReadonlyArray<{
  readonly route: Route;
  readonly label: string;
  readonly key: string;
}> = [
  { route: "orchestrate", label: "Orchestrate", key: "⌘1" },
  { route: "review", label: "Review", key: "⌘2" },
  { route: "edit", label: "Edit", key: "⌘3" },
];

/** The `hiddenInset` title bar: a drag region with the wordmark and the mode switch. */
export const TitleBar = () => {
  const route = useApp((s) => s.route);
  const { setRoute } = useConnection();

  return (
    <header className="titlebar">
      <span className="wordmark">Polaris</span>
      <nav className="modes" aria-label="Mode">
        {MODES.map((mode) => (
          <button
            key={mode.route}
            type="button"
            className="mode"
            aria-pressed={route === mode.route}
            title={`${mode.label} ${mode.key}`}
            onClick={() => setRoute(mode.route)}
          >
            {mode.label}
          </button>
        ))}
      </nav>
    </header>
  );
};
