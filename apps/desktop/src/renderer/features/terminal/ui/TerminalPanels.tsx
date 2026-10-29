/**
 * The Editor's column (DESIGN.md, Chrome redesign → Editor; Paper X-I Variant C): the editor
 * card, and when the terminal shows, the terminal card and the status strip under it, 6px apart.
 * Hidden, the status is the editor card's foot row and the Terminal chip floats over the code.
 */
import { cn, Kbd, Panel, TerminalIcon } from "@polaris/ui";
import { Component, createRef, type ReactNode, type RefObject } from "react";
import { type MorphFrom, playMorph } from "./morph.ts";
import { OpenDrawer, toggleHint, useTerminalDock } from "./TerminalDock.tsx";

export interface TerminalPanelsProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** The editor card's body. */
  readonly children: ReactNode;
  /** The status row's items; where the row sits follows the terminal. */
  readonly status: ReactNode;
}

type Placement = "foot" | "strip";

const ROW = "status-row";

export const TerminalChip = ({
  onToggle,
  count,
}: {
  readonly onToggle: () => void;
  readonly count: number;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={false}
    data-testid="terminal-toggle"
    className="border-hairline bg-raised text-caption text-text-subtle hover:text-text-default shadow-float focus-visible:outline-starlight rounded-row absolute right-3 bottom-3 z-10 flex h-7 cursor-default items-center gap-1.5 border px-2.5 focus-visible:outline-2"
  >
    <TerminalIcon size={12} aria-hidden />
    Terminal
    {count > 1 ? <span className="tabular">{count}</span> : null}
    <Kbd variant="plain">{toggleHint()}</Kbd>
  </button>
);

const StatusRow = ({
  placement,
  children,
}: {
  readonly placement: Placement;
  readonly children: ReactNode;
}) => (
  <div
    data-slot={ROW}
    data-placement={placement}
    className={cn(
      "flex h-7 shrink-0 items-center",
      placement === "foot"
        ? "border-hairline border-t"
        : "border-hairline bg-panel shadow-panel rounded-[12px] border"
    )}
  >
    {children}
  </div>
);

interface MorphProps {
  readonly placement: Placement;
  readonly dock: RefObject<HTMLDivElement | null>;
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly children: ReactNode;
}

type NoState = Readonly<Record<string, never>>;

const rowIn = (root: HTMLElement | null) => root?.querySelector(`[data-slot="${ROW}"]`) ?? null;

/** A class for getSnapshotBeforeUpdate: the row's old place is read before the DOM changes. */
class MorphColumn extends Component<MorphProps, NoState> {
  private readonly own = createRef<HTMLDivElement>();

  override getSnapshotBeforeUpdate(previous: MorphProps): MorphFrom | null {
    if (previous.placement === this.props.placement) return null;
    const box = rowIn(this.own.current)?.getBoundingClientRect();

    return box === undefined ? null : { left: box.left, top: box.top };
  }

  override componentDidUpdate(_previous: MorphProps, _state: NoState, from: MorphFrom | null) {
    const row = rowIn(this.own.current);

    if (from === null || row === null) return;
    const terminal = this.own.current?.querySelector('[data-slot="terminal-card"]') ?? null;

    playMorph(row, from, terminal);
  }

  override render() {
    const { placement, dock, hostKey, workspaceId, children } = this.props;

    return (
      <div
        ref={(node) => {
          this.own.current = node;
          dock.current = node;
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5"
        data-host-key={hostKey}
        data-workspace-id={workspaceId}
        data-terminal={placement === "strip" ? "shown" : "hidden"}
        data-testid="terminal-dock"
      >
        {children}
      </div>
    );
  }
}

export interface EditorColumnProps {
  readonly dock: RefObject<HTMLDivElement | null>;
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly children: ReactNode;
  readonly status: ReactNode;
  /** The terminal card's body while it shows, else null. */
  readonly terminal: ReactNode;
  /** The floating Terminal chip while it's hidden; null without a terminal to open. */
  readonly chip: ReactNode;
}

/** The column's layout alone, so fixtures can show it with a stand-in terminal. */
export const EditorColumn = ({
  dock,
  hostKey,
  workspaceId,
  children,
  status,
  terminal,
  chip,
}: EditorColumnProps) => {
  const strip = terminal !== null;

  return (
    <MorphColumn
      placement={strip ? "strip" : "foot"}
      dock={dock}
      hostKey={hostKey}
      workspaceId={workspaceId}
    >
      <Panel className="min-w-0 flex-1" data-testid="editor-card">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {children}
          {strip ? null : chip}
        </div>
        {strip ? null : <StatusRow placement="foot">{status}</StatusRow>}
      </Panel>
      {strip ? (
        <>
          <Panel className="shrink-0" data-slot="terminal-card">
            {terminal}
          </Panel>
          <StatusRow placement="strip">{status}</StatusRow>
        </>
      ) : null}
    </MorphColumn>
  );
};

export const TerminalPanels = ({ hostKey, workspaceId, children, status }: TerminalPanelsProps) => {
  const { dock, shown, toggle, count, drawerProps } = useTerminalDock(hostKey, workspaceId);

  return (
    <EditorColumn
      dock={dock}
      hostKey={hostKey}
      workspaceId={workspaceId}
      status={status}
      terminal={
        shown && drawerProps !== null ? <OpenDrawer {...drawerProps} variant="panel" /> : null
      }
      chip={drawerProps === null ? null : <TerminalChip onToggle={toggle} count={count} />}
    >
      {children}
    </EditorColumn>
  );
};
