/**
 * The rail's Tools block (Paper R1, R2): the session's Browser and Simulator with what they
 * show now, dimmed while idle. Each opens the panel on its tab.
 */
import { cn, GlobeIcon, hueVar, MobileIcon, type TintHue } from "@polaris/ui";
import type { SessionId } from "@polaris/protocol";
import type { ReactNode } from "react";
import { useBrowserUi } from "../../../browser/index.ts";
import { useHostSimulators, useSimulatorUi } from "../../../simulator/index.ts";
import { plural } from "../../model/format.ts";
import { uiKey } from "../../state.ts";
import { useSimulatorTab } from "../../ui/SimulatorOutput.tsx";
import { pickBrowser } from "../browser.ts";
import { setOutputOpen } from "../open.ts";
import { pickSimulator } from "../simulator.ts";
import { ROW, Section, Slot } from "./parts.tsx";

interface ToolProps {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly harness: TintHue;
  /** The Host is out of reach: every tool reads as idle. */
  readonly away: boolean;
}

/** The dot an agent's tab or Simulator leaves while the user looks elsewhere. */
const AgentDot = ({ harness, label }: { readonly harness: TintHue; readonly label: string }) => (
  <span
    className="size-1.5 shrink-0 self-center rounded-full"
    style={{ backgroundColor: hueVar(harness) }}
    aria-label={label}
  />
);

const ToolRow = ({
  icon,
  name,
  state,
  detail,
  idle,
  onOpen,
  dot,
  testId,
}: {
  readonly icon: ReactNode;
  readonly name: string;
  readonly state: string;
  readonly detail: string | null;
  readonly idle: boolean;
  readonly onOpen: (() => void) | null;
  readonly dot: ReactNode;
  readonly testId: string;
}) => {
  const body = (
    <>
      <Slot className="pt-0.5">{icon}</Slot>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-body text-text-default truncate">
          {name}
          <span className="text-text-subtle"> · {state}</span>
        </span>
        {detail === null ? null : (
          <span className="text-caption text-text-subtle truncate">{detail}</span>
        )}
      </span>
      {dot}
    </>
  );

  const className = cn(
    ROW,
    "min-h-tree-row items-start py-[5px] text-left",
    idle && "opacity-(--opacity-dimmed)"
  );

  return onOpen === null ? (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      className={cn(className, "hover:bg-fill-hover cursor-default")}
      data-testid={testId}
    >
      {body}
    </button>
  );
};

/** "Layout variants — localhost:5173": the page's title and where it is. */
const pageLine = (title: string | null, url: string) => {
  try {
    const place = new URL(url).host;

    return title === null || title === "" ? url : `${title} — ${place}`;
  } catch {
    return title ?? url;
  }
};

const BrowserRow = ({ hostKey, sessionId, harness, away }: ToolProps) => {
  const { tabs, dot } = useBrowserUi(uiKey(hostKey, sessionId));
  const active = tabs.tabs.find((t) => t.tabId === tabs.active) ?? tabs.tabs[0] ?? null;

  return (
    <ToolRow
      icon={<GlobeIcon size={14} />}
      name="Browser"
      state={tabs.tabs.length === 0 ? "no tabs" : plural(tabs.tabs.length, "tab")}
      detail={active === null ? null : pageLine(active.title, active.url)}
      idle={away || active === null}
      onOpen={() => {
        pickBrowser(hostKey, sessionId);
        setOutputOpen(uiKey(hostKey, sessionId), true);
      }}
      dot={dot ? <AgentDot harness={harness} label="An agent opened a tab" /> : null}
      testId="output-rail-browser"
    />
  );
};

const SimulatorRow = ({ hostKey, sessionId, harness, away }: ToolProps) => {
  const here = useSimulatorTab(hostKey);
  const { dot, showing } = useSimulatorUi(uiKey(hostKey, sessionId));
  const simulators = useHostSimulators(hostKey, here)?.simulators ?? [];

  const device =
    simulators.find((s) => s.id === showing && s.state !== "Shutdown") ??
    simulators.find((s) => s.state === "Booted") ??
    null;

  return (
    <ToolRow
      icon={<MobileIcon size={14} />}
      name="Simulator"
      state={here ? (device?.name ?? "not running") : "not on this host"}
      detail={null}
      idle={away || device === null}
      onOpen={
        here
          ? () => {
              pickSimulator(hostKey, sessionId);
              setOutputOpen(uiKey(hostKey, sessionId), true);
            }
          : null
      }
      dot={dot ? <AgentDot harness={harness} label="An agent opened a Simulator" /> : null}
      testId="output-rail-simulator"
    />
  );
};

export const ToolsBlock = (props: ToolProps) => (
  <Section label="Tools">
    <BrowserRow {...props} />
    <SimulatorRow {...props} />
  </Section>
);
