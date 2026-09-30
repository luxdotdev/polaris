/**
 * The where line's Host and Workspace (DESIGN.md, New session): each opens a
 * menu, so a session can start on any connected Host from wherever the user
 * is. A Host with no Workspace starts in its home; "Open folder…" is ⌘O there.
 */
import type { WorkspaceId } from "@polaris/protocol";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@polaris/ui";
import { useMemo } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { barHosts } from "../../../routes/topBar.ts";
import { plural } from "../../../shell/copy.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { stateWords } from "../../../shell/hostCopy.ts";
import { tildePath } from "../model/format.ts";
import { patchSessionUi, uiKey } from "../state.ts";

const TRIGGER =
  "decoration-text-faint cursor-default underline decoration-dotted underline-offset-4";

/** A Host's caption in the menu: its state when not connected, else what it holds. */
const hostCaption = (host: HostView, workspaces: number) =>
  stateWords(host.status.state) ??
  (workspaces === 0 ? "starts in its home folder" : plural(workspaces, "workspace"));

const useBar = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return useMemo(() => barHosts({ hosts, models }), [hosts, models]);
};

export interface WhereMenuProps {
  readonly host: HostView | undefined;
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  /** The draft so far; it follows the session to another Workspace. */
  readonly draft: string;
}

/** Moves the new session, with its draft, to another Host or Workspace. */
const useMove = ({ draft }: Pick<WhereMenuProps, "draft">) => {
  const { startNewSessionIn } = useShellActions();

  return (hostKey: string, workspaceId?: WorkspaceId) => {
    if (workspaceId !== undefined && draft !== "") {
      patchSessionUi(uiKey(hostKey, `new:${workspaceId}`), (ui) =>
        ui.draft === "" ? { draft } : {}
      );
    }

    startNewSessionIn(hostKey, workspaceId ?? null);
  };
};

/** "Mac Studio": every Host, those not connected listed with their state and not choosable. */
export const HostMenu = (props: WhereMenuProps) => {
  const bar = useBar();
  const move = useMove(props);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={TRIGGER} data-testid="where-host">
        {props.host?.label ?? props.hostKey}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuLabel>Run on</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.hostKey}
          onValueChange={(key) => {
            const first = bar.find((h) => h.host.key === key)?.workspaces[0];

            move(key, first?.workspace.id);
          }}
        >
          {bar.map(({ host, workspaces }) => (
            <DropdownMenuRadioItem
              key={host.key}
              value={host.key}
              disabled={host.status.state !== "connected"}
              data-testid="where-host-item"
            >
              <span className="flex flex-col">
                <span>{host.label}</span>
                <span className="text-caption text-text-subtle">
                  {hostCaption(host, workspaces.length)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** "~/code/polaris": the Host's shown Workspaces, then "Open folder…" (⌘O) on that Host. */
export const WorkspaceMenu = (props: WhereMenuProps & { readonly path: string }) => {
  const bar = useBar();
  const move = useMove(props);
  const { openFolder } = useShellActions();
  const homeDir = props.host?.status.host?.homeDir ?? null;
  const shown = bar.find((h) => h.host.key === props.hostKey)?.workspaces ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={TRIGGER} data-testid="where-workspace">
        {tildePath(props.path, homeDir)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuLabel>Workspaces on {props.host?.label ?? props.hostKey}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.workspaceId}
          onValueChange={(id) => {
            const found = shown.find((w) => w.workspace.id === id);

            if (found !== undefined) move(props.hostKey, found.workspace.id);
          }}
        >
          {shown.map(({ workspace }) => (
            <DropdownMenuRadioItem key={workspace.id} value={workspace.id}>
              <span className="flex flex-col">
                <span>{workspace.name}</span>
                <span className="text-caption text-text-subtle font-mono">
                  {tildePath(workspace.path, homeDir)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => openFolder(props.hostKey)}
          data-testid="where-open-folder"
        >
          Open folder…
          <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
