/**
 * Placeholder slot contents, until each feature lands (see app/slots.tsx).
 * They keep the shell usable end to end: a plain jump list, the sessions
 * that need you.
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@polaris/ui";
import { useMemo } from "react";
import { barHosts, needsYou, shownState } from "../routes/topBar.ts";
import { sessionStateLabel } from "../shell/copy.ts";
import { SessionGlyph, SummaryGlyph } from "../shell/glyphs.tsx";
import { useApp, useShellActions } from "../shell/hooks.ts";
import { CompactSessionRow } from "../shell/sidebar/SessionRow.tsx";
import type { JumpMenuProps } from "./slots.tsx";

const Pending = ({ children }: { readonly children: string }) => (
  <div className="p-panel text-body text-text-faint grid flex-1 place-items-center text-center">
    {children}
  </div>
);

export const DefaultSettingsHosts = () => (
  <Pending>Hosts are listed in settings.json for now.</Pending>
);

export const DefaultNoSession = () => <Pending>No agent sessions in this workspace yet.</Pending>;

export const DefaultNeedsYouInbox = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  const waiting = hosts.flatMap((host) =>
    [...(models[host.key]?.sessions.values() ?? [])].flatMap((entry) =>
      needsYou(entry) ? [{ host, entry }] : []
    )
  );

  if (waiting.length === 0) return <Pending>Nothing needs you.</Pending>;

  return (
    <div className="flex flex-col px-2 pt-2">
      {waiting.map(({ host, entry }) => (
        <CompactSessionRow
          key={`${host.key}/${entry.session.id}`}
          hostKey={host.key}
          entry={entry}
          now={0}
          meta={host.label}
        />
      ))}
    </div>
  );
};

export const DefaultJumpMenu = ({ open, onOpenChange }: JumpMenuProps) => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const { selectSession, selectWorkspace } = useShellActions();
  const bar = useMemo(() => barHosts({ hosts, models }), [hosts, models]);

  const go = (run: () => void) => {
    run();
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Jump">
      <CommandInput placeholder="Jump to a session or workspace" />
      <CommandList>
        <CommandEmpty>Nothing matches</CommandEmpty>
        <CommandGroup heading="Sessions">
          {bar.flatMap(({ host }) =>
            [...(models[host.key]?.sessions.values() ?? [])].flatMap((entry) =>
              entry.session.state === "archived"
                ? []
                : [
                    <CommandItem
                      key={`${host.key}/${entry.session.id}`}
                      value={`${entry.session.title} ${host.key} ${entry.session.id}`}
                      leading={
                        <SessionGlyph
                          state={shownState(entry)}
                          harness={entry.session.harness}
                          size={14}
                        />
                      }
                      meta={`${sessionStateLabel[shownState(entry)]} · ${host.label}`}
                      onSelect={() =>
                        go(() => selectSession({ hostKey: host.key, sessionId: entry.session.id }))
                      }
                    >
                      {entry.session.title || "Untitled session"}
                    </CommandItem>,
                  ]
            )
          )}
        </CommandGroup>
        <CommandGroup heading="Workspaces">
          {bar.flatMap((group) =>
            group.workspaces.map((w) => (
              <CommandItem
                key={`${w.hostKey}/${w.workspace.id}`}
                value={`${w.workspace.name} ${group.host.label} ${w.workspace.id}`}
                leading={<SummaryGlyph summary={w.summary} />}
                meta={group.host.label}
                onSelect={() =>
                  go(() => selectWorkspace({ hostKey: w.hostKey, workspaceId: w.workspace.id }))
                }
              >
                {w.workspace.name}
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
