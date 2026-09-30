/**
 * The adaptive top bar (ENG-177): Workspace chips across every Host while
 * there are at most 10 (⌃1…⌃0), the machine bar from 11 (⌃1… per machine),
 * nothing with a single machine in machine mode. A Host's Connection State
 * shows inline, never as a modal.
 */
import { Badge, Chip, cn, Kbd } from "@polaris/ui";
import { Fragment, useMemo } from "react";
import type { HostView } from "../../shared/api.ts";
import { type BarHost, barHosts, shortcutLabel } from "../routes/topBar.ts";
import { plural } from "./copy.ts";
import { HostStateLabel } from "./HostState.tsx";
import { SummaryGlyph } from "./glyphs.tsx";
import { useApp, useSelection, useShellActions } from "./hooks.ts";

/** ⌃N, only on the first ten chips (Chip takes no undefined shortcut). */
interface ChipShortcut {
  shortcut?: string;
}

const useBar = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return useMemo(() => barHosts({ hosts, models }), [hosts, models]);
};

const connected = (host: HostView) => host.status.state === "connected";

const WorkspaceBar = ({ bar }: { readonly bar: ReadonlyArray<BarHost> }) => {
  const selection = useSelection();
  const { selectWorkspace } = useShellActions();
  let index = 0;

  return (
    <nav
      aria-label="Workspaces"
      className="border-hairline bg-surface-sunken flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-3"
    >
      {bar.map((group, groupIndex) => (
        <Fragment key={group.host.key}>
          {groupIndex === 0 ? null : <span className="bg-text-faint/25 mx-1.5 h-4 w-px shrink-0" />}
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 pr-1.5 pl-1",
              group.host.status.state === "reconnecting" && "opacity-(--opacity-dimmed)"
            )}
            title={group.host.status.failure?.detail}
            data-host={group.host.key}
            data-connection={group.host.status.state}
          >
            <span className="text-caption text-text-faint">{group.host.label}</span>
            <HostStateLabel host={group.host} />
          </span>
          {group.workspaces.map(({ hostKey, workspace, summary }) => {
            const shortcut = shortcutLabel(index++);
            const extra: ChipShortcut = {};

            if (shortcut !== undefined) extra.shortcut = shortcut;

            return (
              <Chip
                key={workspace.id}
                title={workspace.path}
                selected={hostKey === selection.hostKey && workspace.id === selection.workspaceId}
                needsYou={summary.needsYou}
                {...extra}
                leading={<SummaryGlyph summary={summary} />}
                onClick={(event) =>
                  selectWorkspace({ hostKey, workspaceId: workspace.id }, event.timeStamp)
                }
              >
                {workspace.name}
              </Chip>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
};

const machineCaption = (group: BarHost) => {
  if (!connected(group.host)) return null;

  return plural(group.workspaces.length, "workspace");
};

const MachineBar = ({ bar }: { readonly bar: ReadonlyArray<BarHost> }) => {
  const selection = useSelection();
  const { selectHost } = useShellActions();

  return (
    <nav
      aria-label="Machines"
      className="h-session-row border-hairline bg-surface-sunken flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3"
    >
      {bar.map((group, index) => {
        const selected = group.host.key === selection.hostKey;
        const shortcut = shortcutLabel(index);
        const caption = machineCaption(group);

        return (
          <button
            key={group.host.key}
            type="button"
            aria-pressed={selected}
            data-host={group.host.key}
            data-connection={group.host.status.state}
            onClick={(event) => selectHost(group.host.key, event.timeStamp)}
            className={cn(
              "flex h-[34px] shrink-0 cursor-default items-center gap-gap rounded-[8px] border border-transparent px-row-x",
              selected
                ? "border-hairline bg-surface-raised shadow-[0_1px_2px_#0000000a]"
                : "hover:bg-fill-hover",
              group.host.status.state === "reconnecting" &&
                !selected &&
                "opacity-(--opacity-dimmed)"
            )}
          >
            <SummaryGlyph summary={group.summary} />
            <span className={cn("text-label", selected ? "text-text-strong" : "text-text-default")}>
              {group.host.label}
            </span>
            {caption === null ? (
              <HostStateLabel host={group.host} />
            ) : (
              <span
                className={cn("text-caption", selected ? "text-text-subtle" : "text-text-faint")}
              >
                {caption}
              </span>
            )}
            {group.summary.needsYou > 0 ? (
              <Badge tone="needs-you" size="count">
                {group.summary.needsYou}
              </Badge>
            ) : null}
            {shortcut === undefined ? null : <Kbd variant="plain">{shortcut}</Kbd>}
          </button>
        );
      })}
    </nav>
  );
};

export const TopBar = () => {
  const bar = useBar();
  const { topBar } = useSelection();

  if (topBar === "hidden" || bar.length === 0) return null;

  return topBar === "workspaces" ? <WorkspaceBar bar={bar} /> : <MachineBar bar={bar} />;
};
