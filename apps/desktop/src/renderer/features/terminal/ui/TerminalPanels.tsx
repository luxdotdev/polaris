/**
 * A pane with its Workspace's terminal as a card under it (DESIGN.md, Chrome redesign → Editor;
 * Paper X-I Variant C), 6px apart. In the Editor the status row is the card's foot while the
 * terminal hides and a strip under it while it shows; New session and the Workspace stage have
 * none. Hidden, the Terminal chip floats at the card's bottom right. The change is a morph.
 */
import { cn, Kbd, Panel, TerminalIcon } from "@polaris/ui";
import { Component, createRef, type ReactNode, type RefObject } from "react";
import { useTerminalLeaving } from "./leaving.ts";
import { partsIn, playDivide, playJoin, settle } from "./morph.ts";
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
    data-morph={placement === "strip" ? "strip" : undefined}
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
  /** The terminal is hidden but still laid out, while the join plays. */
  readonly leaving: boolean;
  readonly dock: RefObject<HTMLDivElement | null>;
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly children: ReactNode;
}

type NoState = Readonly<Record<string, never>>;

/** A class for componentDidUpdate's previous props: which way the column just changed. */
class MorphColumn extends Component<MorphProps, NoState> {
  private readonly own = createRef<HTMLDivElement>();

  override componentDidUpdate(previous: MorphProps) {
    const root = this.own.current;
    const { placement, leaving } = this.props;

    if (root === null) return;

    if (placement === "foot") {
      if (previous.placement === "strip") settle(root);

      return;
    }

    const parts = partsIn(root);

    if (parts === null) return;

    if (previous.placement === "foot") playDivide(parts, true);
    else if (leaving && !previous.leaving) playJoin(parts);
    else if (!leaving && previous.leaving) playDivide(parts, false);
  }

  override render() {
    const { placement, dock, hostKey, workspaceId, children } = this.props;

    return (
      <div
        ref={(node) => {
          this.own.current = node;
          dock.current = node;
        }}
        className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col gap-1.5"
        data-host-key={hostKey}
        data-workspace-id={workspaceId}
        data-terminal={placement === "strip" ? "shown" : "hidden"}
        data-testid="terminal-dock"
      >
        <div
          aria-hidden
          data-morph="fill"
          className="bg-panel pixelated pointer-events-none invisible absolute inset-x-0 -z-10 bg-no-repeat"
        />
        {children}
      </div>
    );
  }
}

export interface TerminalColumnProps {
  readonly dock: RefObject<HTMLDivElement | null>;
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly children: ReactNode;
  /** The status row's items; omitted, the column has no status row. */
  readonly status?: ReactNode;
  /** The card's test id. */
  readonly cardTestId: string;
  /** The terminal card's body while it shows, else null. */
  readonly terminal: ReactNode;
  /** The terminal is hidden but `terminal` is still passed, while it leaves. Default false. */
  readonly leaving?: boolean;
  /** The floating Terminal chip while it's hidden; null without a terminal to open. */
  readonly chip: ReactNode;
}

/** The column's layout alone, so fixtures can show it with a stand-in terminal. */
export const TerminalColumn = ({
  dock,
  hostKey,
  workspaceId,
  children,
  status,
  cardTestId,
  terminal,
  leaving = false,
  chip,
}: TerminalColumnProps) => {
  const strip = terminal !== null;
  const row = status !== undefined;

  return (
    <MorphColumn
      placement={strip ? "strip" : "foot"}
      leaving={leaving}
      dock={dock}
      hostKey={hostKey}
      workspaceId={workspaceId}
    >
      <Panel className="min-w-0 flex-1" data-testid={cardTestId} data-morph="card">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {children}
          {strip ? null : chip}
        </div>
        {strip || !row ? null : <StatusRow placement="foot">{status}</StatusRow>}
      </Panel>
      {strip ? (
        <>
          <div className="shrink-0" data-morph="well" inert={leaving}>
            <Panel data-slot="terminal-card" data-morph="terminal">
              {terminal}
            </Panel>
          </div>
          {row ? <StatusRow placement="strip">{status}</StatusRow> : null}
        </>
      ) : null}
    </MorphColumn>
  );
};

export type EditorColumnProps = Omit<TerminalColumnProps, "cardTestId"> & {
  readonly status: ReactNode;
};

/** The Editor's column: the editor card with the status row. */
export const EditorColumn = (props: EditorColumnProps) => (
  <TerminalColumn {...props} cardTestId="editor-card" />
);

interface LiveColumnProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly children: ReactNode;
  readonly status?: ReactNode;
  readonly cardTestId: string;
}

/** The column on the Workspace's own terminal drawer. */
const LiveColumn = ({ hostKey, workspaceId, children, status, cardTestId }: LiveColumnProps) => {
  const { dock, shown, toggle, count, drawerProps } = useTerminalDock(hostKey, workspaceId);
  const leaving = useTerminalLeaving(shown);

  return (
    <TerminalColumn
      dock={dock}
      hostKey={hostKey}
      workspaceId={workspaceId}
      status={status}
      cardTestId={cardTestId}
      leaving={leaving}
      terminal={
        (shown || leaving) && drawerProps !== null ? (
          <OpenDrawer {...drawerProps} variant="panel" />
        ) : null
      }
      chip={drawerProps === null ? null : <TerminalChip onToggle={toggle} count={count} />}
    >
      {children}
    </TerminalColumn>
  );
};

export const TerminalPanels = (props: TerminalPanelsProps) => (
  <LiveColumn {...props} cardTestId="editor-card" />
);

export interface PaneTerminalProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** The pane's body, filling the card. */
  readonly children: ReactNode;
}

/** A Workspace pane with no status row (New session, the Workspace stage) and its terminal. */
export const PaneTerminal = ({ hostKey, workspaceId, children }: PaneTerminalProps) => (
  <LiveColumn hostKey={hostKey} workspaceId={workspaceId} cardTestId="pane-card">
    {children}
  </LiveColumn>
);
