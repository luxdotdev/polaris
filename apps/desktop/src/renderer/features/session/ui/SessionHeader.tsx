/**
 * The Intent column's header (artboard 5): the session title (click to
 * rename), its Harness and state, and a menu for permission mode, Fork and
 * Archive. A refused Archive (a Turn in flight) says why in a toast.
 */
import type { PermissionMode } from "@polaris/protocol";
import {
  Button,
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  type Harness,
  HarnessMark,
  Input,
} from "@polaris/ui";
import { useState } from "react";
import { Commands } from "../../../commands.ts";
import type { SessionData } from "../../../store/plain.ts";
import { sessionStateLabel } from "../../../shell/copy.ts";
import { OpenInTerminalItem } from "../../terminal/index.ts";
import { send } from "../dispatch.ts";
import {
  archiveCommand,
  PERMISSION_MODES,
  permissionCommand,
  permissionLabel,
  renameCommand,
} from "../model/intent.ts";

export interface SessionHeaderProps {
  readonly hostKey: string;
  readonly session: SessionData;
  readonly harness: Harness | null;
  readonly turnNumber: number | null;
  readonly canFork: boolean;
  readonly onFork: () => void;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const Title = ({ hostKey, session }: { hostKey: string; session: SessionData }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const title = session.title === "" ? "Untitled session" : session.title;

  const commit = () => {
    const command = editing === null ? null : renameCommand(session.id, editing);

    setEditing(null);

    if (command !== null && editing?.trim() !== session.title)
      void send(hostKey, command, "Couldn't rename");
  };

  if (editing !== null) {
    return (
      <Input
        autoFocus
        aria-label="Session title"
        value={editing}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          else if (event.key === "Escape") setEditing(null);
        }}
        className="text-title h-8"
      />
    );
  }

  return (
    <h1
      className="text-title text-text-strong cursor-text truncate"
      title="Click to rename"
      data-testid="session-title"
      onClick={() => setEditing(session.title)}
    >
      {title}
    </h1>
  );
};

const SessionMenu = ({
  hostKey,
  session,
  canFork,
  onFork,
}: Omit<SessionHeaderProps, "harness" | "turnNumber">) => {
  const archived = session.state === "archived";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Session actions"
          data-testid="session-menu"
        >
          <ChevronDownIcon size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Permissions
            <span className="text-caption text-text-faint ml-auto pl-3">
              {permissionLabel(session.permissionMode)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={session.permissionMode}
              onValueChange={(mode) => {
                const found = PERMISSION_MODES.find((p) => p.mode === mode);

                if (found !== undefined) void setPermission(hostKey, session, found.mode);
              }}
            >
              {PERMISSION_MODES.map((p) => (
                <DropdownMenuRadioItem key={p.mode} value={p.mode}>
                  <span className="flex flex-col">
                    <span>{p.label}</span>
                    <span className="text-caption text-text-faint">{p.detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem disabled={!canFork} onSelect={onFork}>
          Fork…
        </DropdownMenuItem>
        <OpenInTerminalItem
          session={{
            hostKey,
            workspaceId: session.workspaceId,
            sessionId: session.id,
            state: session.state,
            title: session.title === "" ? session.harness : session.title,
          }}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="archive-session"
          onSelect={() =>
            void send(
              hostKey,
              archived
                ? Commands.UnarchiveSession({ sessionId: session.id })
                : archiveCommand(session.id),
              archived ? "Couldn't unarchive" : "Couldn't archive"
            )
          }
        >
          {archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const setPermission = (hostKey: string, session: SessionData, mode: PermissionMode) =>
  send(hostKey, permissionCommand(session.id, mode), "Couldn't change permissions");

export const SessionHeader = (props: SessionHeaderProps) => {
  const { hostKey, session, harness, turnNumber } = props;
  const state = capitalized(sessionStateLabel[session.state]);

  return (
    <header className="border-hairline gap-row-x pt-panel flex shrink-0 flex-col border-b px-5 pb-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Title hostKey={hostKey} session={session} />
        </div>
        <SessionMenu {...props} />
      </div>
      <div className="flex items-center gap-3">
        {harness === null ? (
          <span className="text-label text-text-default">{session.harness}</span>
        ) : (
          <HarnessMark harness={harness} named />
        )}
        <span className="text-caption text-text-subtle tabular" data-testid="session-state">
          {turnNumber === null ? state : `${state} · turn ${turnNumber}`}
        </span>
        <span className="flex-1" />
        <span className="text-caption text-text-faint">
          {permissionLabel(session.permissionMode)}
        </span>
      </div>
    </header>
  );
};
