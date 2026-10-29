/**
 * The roster's Subagents as rows (`model/subagents.ts`), shared by the composer's moons
 * popover and the conversation's "Waiting on" hover: the moon (working while it works), agent
 * type, task, status and elapsed time. Each row opens the Subagent in Output's Subagent tab.
 */
import { Celestial, type Harness, subagentMoon } from "@polaris/ui";
import { useElapsed } from "../hooks.ts";
import { formatElapsed } from "../model/format.ts";
import type { RosterRow } from "../model/subagents.ts";

/** A Subagent's moon: its place among its Turn's Subagents; still once it has ended. */
export const SubagentMoon = ({
  index,
  working,
  harness,
  className,
}: {
  readonly index: number;
  readonly working: boolean;
  readonly harness: Harness | null;
  readonly className?: string;
}) =>
  harness === null ? null : (
    <Celestial
      body={subagentMoon(index)}
      harness={harness}
      size={16}
      working={working}
      dormant={!working}
      className={className}
    />
  );

/** How long it has run, ticking while it works; how long it took once ended. */
export const SubagentElapsed = ({
  startedAt,
  endedAt,
  working,
}: {
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly working: boolean;
}) => {
  const running = useElapsed(startedAt, working);
  const ms = endedAt === null ? running : Date.parse(endedAt) - Date.parse(startedAt);

  return (
    <span className="text-caption text-text-subtle tabular shrink-0">
      {Number.isNaN(ms) ? "" : formatElapsed(ms)}
    </span>
  );
};

export interface SubagentRowsProps {
  readonly rows: ReadonlyArray<RosterRow>;
  readonly harness: Harness | null;
  readonly onOpen: (subagentId: string) => void;
}

/** The rows, each a button that opens its Subagent. */
export const SubagentRows = ({ rows, harness, onOpen }: SubagentRowsProps) => (
  <ul className="flex flex-col" data-testid="subagent-rows">
    {rows.map((row) => (
      <li key={row.id}>
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          data-testid="subagent-row"
          data-subagent={row.id}
          aria-label={`Open ${row.agent}: ${row.task}`}
          className="h-row gap-row-x hover:bg-fill-hover flex w-full min-w-0 cursor-default items-center rounded-full px-3 text-left"
        >
          <SubagentMoon index={row.index} working={row.working} harness={harness} />
          <span className="text-label text-text-strong shrink-0">{row.agent}</span>
          <span className="text-body text-text-default min-w-0 flex-1 truncate">{row.task}</span>
          <span className="text-caption text-text-subtle max-w-[40%] shrink-0 truncate">
            {row.status}
          </span>
          <SubagentElapsed startedAt={row.startedAt} endedAt={row.endedAt} working={row.working} />
        </button>
      </li>
    ))}
  </ul>
);

/** The mono kicker over a roster list: "SUBAGENTS · 2 RUNNING · 1 DONE". */
export const RosterKicker = ({ parts }: { readonly parts: ReadonlyArray<string> }) => (
  <p className="text-micro text-text-subtle px-3 pt-2 pb-1.5 font-mono tracking-[0.1em] uppercase">
    {parts.join(" · ")}
  </p>
);
