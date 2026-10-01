/**
 * Settings → Harnesses (DESIGN.md, Settings; Paper S1): one group per catalogue
 * Harness with its tile, "Ready on N of M hosts", a row per Host with at most
 * one action, and the defaults new sessions start with.
 */
import { ChevronRightIcon, cn, Dither, Tile } from "@polaris/ui";
import { useState } from "react";
import { slots } from "../../../app/slots.tsx";
import { type HarnessGroup, harnessGroups, type HostRow } from "../model/harnesses.ts";
import { Action, GLYPHS } from "./harnessRow.tsx";
import { sectionInfo } from "../model/sections.ts";
import { useHostProbes } from "./hostProbes.ts";
import { Column, PageHeader } from "./parts.tsx";
import { SessionDefaultsStrip } from "./SessionDefaultsStrip.tsx";

const Row = ({
  row,
  signingIn,
  onSignIn,
  onExit,
  onClose,
}: {
  readonly row: HostRow;
  readonly signingIn: boolean;
  readonly onSignIn: () => void;
  readonly onExit: () => void;
  readonly onClose: () => void;
}) => (
  <div className="flex flex-col" data-testid="harness-host-row">
    <div className="px-panel flex h-[39px] shrink-0 items-center">
      <span className="text-label text-text-default w-[168px] shrink-0 truncate pr-3">
        {row.hostLabel}
      </span>
      <span className="text-caption text-text-subtle w-24 shrink-0 truncate font-mono">
        {row.version ?? "—"}
      </span>
      <span
        className={cn(
          "text-label font-regular flex min-w-0 flex-1 items-center gap-1.5",
          row.ready ? "text-text-subtle" : "text-text-default"
        )}
      >
        <span className="text-text-subtle flex w-3.5 shrink-0 justify-center">
          {GLYPHS[row.glyph]}
        </span>
        <span className={cn("truncate", row.note !== null && "shrink-0")}>{row.text}</span>
        {row.note === null ? null : (
          <span className="text-caption text-text-subtle truncate" data-testid="harness-row-note">
            · {row.note}
          </span>
        )}
      </span>
      {/* An empty action slot lends its width to the status (a noted row has no action). */}
      {row.action === null && row.note !== null ? null : (
        <span className="flex w-[170px] shrink-0 justify-end">
          {row.action === null ? null : <Action action={row.action} onSignIn={onSignIn} />}
        </span>
      )}
    </div>
    {signingIn && row.action?.kind === "sign-in" ? (
      <slots.HarnessTerminal
        hostKey={row.hostKey}
        argv={row.action.argv}
        onExit={onExit}
        onClose={onClose}
      />
    ) : null}
  </div>
);

const GroupHeader = ({
  group,
  folded,
  onToggle,
}: {
  readonly group: HarnessGroup;
  readonly folded: boolean;
  readonly onToggle: (() => void) | null;
}) => {
  const body = (
    <>
      <Tile hue={group.kind} size={40}>
        <Dither hue={group.kind} size={20} />
      </Tile>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="text-heading-sm text-text-strong font-medium">{group.name}</span>
        <span className="text-caption text-text-subtle truncate">{group.caption}</span>
      </span>
      <span className="text-caption text-text-subtle shrink-0">{group.summary}</span>
      {onToggle === null ? null : (
        <ChevronRightIcon
          size={14}
          className={cn("text-text-subtle shrink-0", !folded && "rotate-90")}
        />
      )}
    </>
  );

  const className = "px-panel flex w-full items-center gap-3 py-[calc(var(--spacing-gap)+4px)]";

  if (onToggle === null) return <div className={className}>{body}</div>;

  return (
    <button
      type="button"
      aria-expanded={!folded}
      onClick={onToggle}
      className={cn(className, "cursor-default")}
    >
      {body}
    </button>
  );
};

const GroupView = ({
  group,
  refresh,
}: {
  readonly group: HarnessGroup;
  readonly refresh: (hostKey: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const folded = group.collapsible && !open;
  const modelHost = group.rows.find((r) => r.ready)?.hostKey ?? null;

  return (
    <section
      aria-label={group.name}
      data-testid="harness-group"
      className="rounded-card border-hairline divide-hairline flex flex-col divide-y overflow-clip border bg-[light-dark(var(--color-surface-raised),transparent)]"
    >
      <GroupHeader
        group={group}
        folded={folded}
        onToggle={group.collapsible ? () => setOpen(!open) : null}
      />
      {folded
        ? null
        : group.rows.map((row) => (
            <Row
              key={row.hostKey}
              row={row}
              signingIn={signingIn === row.hostKey}
              onSignIn={() => setSigningIn(row.hostKey)}
              onExit={() => refresh(row.hostKey)}
              onClose={() => {
                setSigningIn(null);
                refresh(row.hostKey);
              }}
            />
          ))}
      {folded ? null : <SessionDefaultsStrip harness={group.kind} modelHost={modelHost} />}
    </section>
  );
};

export const HarnessesPage = () => {
  const { hosts, refresh } = useHostProbes();
  const info = sectionInfo("harnesses");

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      {harnessGroups(hosts).map((group) => (
        <GroupView key={group.kind} group={group} refresh={refresh} />
      ))}
    </Column>
  );
};
