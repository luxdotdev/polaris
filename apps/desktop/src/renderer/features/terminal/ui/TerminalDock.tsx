/**
 * The terminal drawer under a pane (DESIGN.md, Terminal): a 28px strip while
 * hidden, a resizable drawer with tabs when shown. ⌃` toggles it. One per
 * Workspace; its tabs are the Workspace's shell and any hand-off terminals.
 */
import { Button, ChevronDownIcon, CloseIcon, cn, IconButton, Kbd } from "@polaris/ui";
import { type PointerEvent, type ReactNode, useEffect, useRef } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import {
  activateTab,
  closeTab,
  reopenTab,
  setDrawerHeight,
  type TerminalPlace,
  toggleTerminal,
} from "../actions.ts";
import { endedLine } from "../model/launch.ts";
import { activeTab, clampHeight, type Drawer, type TerminalTab } from "../model/tabs.ts";
import { loaded } from "../loaded.ts";
import { drawerKey, useDrawer } from "../store.ts";
import { TerminalSurface } from "./TerminalSurface.tsx";

export interface TerminalDockProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly children: ReactNode;
}

const TOGGLE_HINT = "⌃`";

const useWorkspace = (hostKey: string, workspaceId: string) =>
  useApp((s) => (s.hostModels[hostKey] ?? emptyHostModel).workspaces.get(workspaceId));

/** ⌃` (Control and the key left of 1, whatever the layout prints on it). */
const useToggleKey = (toggle: () => void) => {
  const latest = useRef(toggle);

  latest.current = toggle;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Backquote" || !event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      latest.current();
    };

    window.addEventListener("keydown", onKey, { capture: true });

    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
};

/** Reattaches this Host's terminal feeds once its connection is back. */
const useReattach = (hostKey: string) => {
  const epoch = useApp((s) => {
    const status = s.hosts.find((h) => h.key === hostKey)?.status;

    return status?.state === "connected" ? status.epoch : null;
  });

  useEffect(() => {
    if (epoch !== null) loaded.runtime?.reattachDropped(hostKey);
  }, [hostKey, epoch]);
};

const Tab = ({
  tab,
  active,
  onSelect,
  onClose,
}: {
  readonly tab: TerminalTab;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
}) => (
  <div
    className={cn(
      "group rounded-control flex h-7 max-w-64 min-w-0 items-center gap-1 pr-1 pl-2.5",
      active ? "bg-fill-selected text-text-strong" : "text-text-subtle hover:bg-fill-hover"
    )}
  >
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className="text-label min-w-0 flex-1 cursor-default truncate text-left"
      data-testid="terminal-tab"
    >
      {tab.title}
    </button>
    <button
      type="button"
      aria-label={`Close ${tab.title}`}
      onClick={onClose}
      className={cn(
        "rounded-control text-text-subtle hover:text-text-default grid size-5 cursor-default place-items-center",
        active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      )}
    >
      <CloseIcon size={10} />
    </button>
  </div>
);

const Ended = ({ tab, onReopen }: { readonly tab: TerminalTab; readonly onReopen: () => void }) => {
  const line = endedLine(tab.status);

  if (line === null) return null;

  return (
    <div
      className="border-hairline bg-surface-sunken flex h-9 shrink-0 items-center gap-3 border-t px-3"
      data-testid="terminal-ended"
    >
      <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{line}</span>
      <Button size="sm" onClick={onReopen}>
        {tab.sessionId === null ? "Open a new terminal here" : "Run again"}
      </Button>
    </div>
  );
};

const Strip = ({ onToggle, count }: { readonly onToggle: () => void; readonly count: number }) => (
  <div className="border-hairline flex h-7 shrink-0 items-center border-t px-1.5">
    <Button
      variant="ghost"
      size="xs"
      onClick={onToggle}
      aria-expanded={false}
      data-testid="terminal-toggle"
    >
      Terminal
      {count > 1 ? <span className="text-text-subtle tabular">{count}</span> : null}
      <Kbd variant="plain">{TOGGLE_HINT}</Kbd>
    </Button>
  </div>
);

const useResize = (place: TerminalPlace, dock: React.RefObject<HTMLDivElement | null>) => {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const box = dock.current?.getBoundingClientRect();

    if (box === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (e: globalThis.PointerEvent) =>
      setDrawerHeight(place, clampHeight(box.bottom - e.clientY, box.height));

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return onPointerDown;
};

interface OpenDrawerProps {
  readonly place: TerminalPlace;
  readonly drawer: Drawer;
  readonly where: string;
  readonly onHide: () => void;
  readonly dock: React.RefObject<HTMLDivElement | null>;
}

const OpenDrawer = ({ place, drawer, where, onHide, dock }: OpenDrawerProps) => {
  const tab = activeTab(drawer);
  const onResize = useResize(place, dock);
  const available = dock.current?.getBoundingClientRect().height ?? Number.POSITIVE_INFINITY;

  return (
    <section
      aria-label="Terminal"
      className="border-hairline bg-bg relative flex shrink-0 flex-col border-t"
      style={{ height: clampHeight(drawer.height, available) }}
      data-testid="terminal-drawer"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the terminal"
        onPointerDown={onResize}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
      />
      <div className="flex h-9 shrink-0 items-center gap-1 px-1.5" role="tablist">
        {drawer.tabs.map((t) => (
          <Tab
            key={t.key}
            tab={t}
            active={t.key === tab?.key}
            onSelect={() => activateTab(place, t.key)}
            onClose={() => closeTab(place, t.key)}
          />
        ))}
        <span className="flex-1" />
        <span className="text-code-inline text-text-subtle truncate px-2 font-mono">{where}</span>
        <IconButton
          size="sm"
          label="Hide terminal"
          shortcut={TOGGLE_HINT}
          icon={<ChevronDownIcon size={14} />}
          onClick={onHide}
        />
      </div>
      {tab === undefined || tab.terminalId === null ? (
        <div className="flex-1" />
      ) : (
        <TerminalSurface
          key={`${place.hostKey}/${tab.terminalId}`}
          hostKey={place.hostKey}
          terminalId={tab.terminalId}
          autoFocus
        />
      )}
      {tab === undefined ? null : <Ended tab={tab} onReopen={() => void reopenTab(place, tab)} />}
    </section>
  );
};

export const TerminalDock = ({ hostKey, workspaceId, children }: TerminalDockProps) => {
  const place: TerminalPlace = { hostKey, workspaceId };
  const drawer = useDrawer(drawerKey(hostKey, workspaceId));
  const workspace = useWorkspace(hostKey, workspaceId);
  const homeDir = useApp((s) => s.hosts.find((h) => h.key === hostKey)?.status.host?.homeDir);
  const dock = useRef<HTMLDivElement>(null);
  const cwd = workspace?.path ?? null;

  const toggle = () => {
    if (cwd !== null) toggleTerminal(place, cwd, workspace?.name ?? "Terminal");
  };

  useToggleKey(toggle);
  useReattach(hostKey);

  const tab = activeTab(drawer);
  const shownCwd = tab?.cwd ?? cwd ?? "";

  const where =
    homeDir !== undefined && shownCwd.startsWith(homeDir)
      ? `~${shownCwd.slice(homeDir.length)}`
      : shownCwd;

  return (
    <div ref={dock} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {cwd === null ? null : drawer.open && drawer.tabs.length > 0 ? (
        <OpenDrawer place={place} drawer={drawer} where={where} onHide={toggle} dock={dock} />
      ) : (
        <Strip onToggle={toggle} count={drawer.tabs.length} />
      )}
    </div>
  );
};
