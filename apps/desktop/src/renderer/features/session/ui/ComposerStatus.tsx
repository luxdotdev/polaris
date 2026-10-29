/**
 * The composer footer's right side (Paper X-E): the running Subagents as their moons and a
 * count (a popover lists each), the context ring (hover for the context card), and the
 * permission mode chip with its menu.
 */
import {
  Celestial,
  CHIP,
  cn,
  ContextRing,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  type Harness,
  Popover,
  PopoverContent,
  PopoverTrigger,
  subagentMoon,
} from "@polaris/ui";
import type { SessionData } from "../../../store/plain.ts";
import type { SubagentView } from "../../../store/sessionModel.ts";
import { send } from "../dispatch.ts";
import { useHost } from "../hooks.ts";
import { permissionCommand, permissionLabel, permissionModesOn } from "../model/intent.ts";
import { contextChip, contextLabel } from "../model/meta.ts";
import { subagentRoster } from "../model/subagents.ts";
import { ContextReadout } from "./ContextCard.tsx";
import { PermissionGlyph } from "./permissionGlyphs.tsx";

const MOONS_SHOWN = 3;

// As the composer narrows, Send stays put: "· nearly full" goes first (the strip says it),
// then the permission chip keeps its glyph, then the Subagents chip its count.
const NEARLY_FULL_WORDS = "hidden @min-[600px]/composer:inline";

const PERMISSION_WORDS = "hidden @min-[500px]/composer:inline";

const SUBAGENT_WORDS = "hidden @min-[440px]/composer:inline";

const Subagents = ({
  harness,
  subagents,
}: {
  readonly harness: Harness;
  readonly subagents: ReadonlyArray<SubagentView>;
}) => {
  const roster = subagentRoster(subagents);

  if (roster.running === 0) return null;
  const moons = roster.rows.filter((r) => r.working).slice(0, MOONS_SHOWN);
  const kicker = [`${roster.running} running`, roster.done > 0 ? `${roster.done} done` : null];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="composer-subagents"
          className={cn(CHIP, "pr-gap gap-[7px] bg-transparent pl-1")}
        >
          <span className="flex" aria-hidden="true">
            {moons.map((m, i) => (
              <Celestial
                key={m.id}
                body={subagentMoon(m.index)}
                harness={harness}
                size={16}
                className={i === 0 ? undefined : "-ml-1.5"}
              />
            ))}
          </span>
          <span className="text-caption text-text-subtle tabular whitespace-nowrap">
            {roster.running}
            <span className={SUBAGENT_WORDS}>
              {roster.running === 1 ? " subagent" : " subagents"}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        data-surface="raised"
        className="flex w-[460px] max-w-[calc(100vw-24px)] flex-col p-1"
        data-testid="subagents-popover"
      >
        <p className="text-micro text-text-subtle px-3 pt-2 pb-1.5 font-mono tracking-[0.1em] uppercase">
          {["Subagents", ...kicker].filter((p) => p !== null).join(" · ")}
        </p>
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {roster.rows.map((row) => (
            <li key={row.id} className="h-row gap-row-x flex items-center rounded-full px-3">
              <Celestial
                body={subagentMoon(row.index)}
                harness={harness}
                size={16}
                dormant={!row.working}
              />
              <span className="text-label text-text-strong shrink-0">{row.agent}</span>
              <span className="text-body text-text-default min-w-0 flex-1 truncate">
                {row.task}
              </span>
              <span className="text-caption text-text-subtle max-w-[45%] shrink-0 truncate">
                {row.status}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

/** "17%", "91% · nearly full", "84k" while the window is unknown, or "—" before any report. */
const ContextChip = ({
  hostKey,
  session,
  turnNumber,
}: {
  readonly hostKey: string;
  readonly session: SessionData;
  readonly turnNumber: number | null;
}) => {
  const usage = session.contextUsage;
  const label = contextLabel(usage);
  const chip = contextChip(usage);

  const readout = (
    <>
      <ContextRing share={chip.share} />
      <span className="text-caption text-text-default tabular font-mono whitespace-nowrap">
        {chip.words}
        {chip.nearlyFull ? <span className={NEARLY_FULL_WORDS}> · nearly full</span> : null}
      </span>
    </>
  );

  // Nothing to open yet: the chip holds its place so the footer doesn't shift on the first report.
  if (label === null)
    return (
      <span
        data-testid="composer-context-unknown"
        title="No context report yet"
        aria-label="Context usage not reported yet"
        className={cn(CHIP, "pr-row-x pl-gap cursor-default gap-[7px]")}
      >
        {readout}
      </span>
    );

  return (
    <ContextReadout
      hostKey={hostKey}
      session={session}
      label={label.text}
      detail={label.detail}
      turnNumber={turnNumber}
      triggerClassName={cn(CHIP, "pr-row-x pl-gap gap-[7px]")}
    >
      {readout}
    </ContextReadout>
  );
};

const Permission = ({
  hostKey,
  session,
}: {
  readonly hostKey: string;
  readonly session: SessionData;
}) => {
  const modes = permissionModesOn(useHost(hostKey)?.status.capabilities ?? []);
  const current = session.permissionMode;

  const pick = (mode: string) => {
    const found = modes.find((p) => p.mode === mode);

    if (found !== undefined && found.mode !== current)
      void send(hostKey, permissionCommand(session.id, found.mode), "Couldn't change permissions");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Permissions: ${permissionLabel(current)}`}
          data-testid="composer-permission"
          className={cn(CHIP, "px-row-x text-text-default gap-[7px]")}
        >
          <PermissionGlyph mode={current} />
          <span className={cn("text-caption font-medium", PERMISSION_WORDS)}>
            {permissionLabel(current)}
          </span>
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            aria-hidden="true"
            className="text-text-faint"
          >
            <path
              d="M1.5 3l2.5 2.5L6.5 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-[280px]">
        <DropdownMenuRadioGroup value={current} onValueChange={pick}>
          {modes.map((p) => (
            <DropdownMenuRadioItem key={p.mode} value={p.mode} className="items-start">
              <span className="text-text-subtle mt-[3px]">
                <PermissionGlyph mode={p.mode} />
              </span>
              <span className="flex flex-col py-0.5">
                <span className="text-label text-text-strong">{p.label}</span>
                <span className="text-caption text-text-subtle">{p.detail}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export interface ComposerStatusProps {
  readonly hostKey: string;
  readonly harness: Harness;
  readonly session: SessionData;
  /** The latest Turn's Subagents. */
  readonly subagents: ReadonlyArray<SubagentView>;
  readonly turnNumber: number | null;
}

export const ComposerStatus = ({
  hostKey,
  harness,
  session,
  subagents,
  turnNumber,
}: ComposerStatusProps) => (
  <>
    <Subagents harness={harness} subagents={subagents} />
    <ContextChip hostKey={hostKey} session={session} turnNumber={turnNumber} />
    <Permission hostKey={hostKey} session={session} />
  </>
);
