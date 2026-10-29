/**
 * The Intent column's header (artboard 5): the session title (click to
 * rename), its Harness and state, how full its context is (hover for the
 * Session context card), and a menu for
 * permission mode, Fork and Archive. A refused Archive (a Turn in flight)
 * says why in a toast.
 */
import type { PermissionMode } from "@polaris/protocol";
import {
  cn,
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
  Celestial,
  type Harness,
  harnessHue,
  harnessTextVar,
  Input,
  sessionCelestial,
} from "@polaris/ui";
import { useState } from "react";
import { Commands } from "../../../commands.ts";
import type { SessionData } from "../../../store/plain.ts";
import { sessionStateLabel, usageLimitLine } from "../../../shell/copy.ts";
import { keepTerminalFocus, OpenInTerminalItem } from "../../terminal/index.ts";
import { send } from "../dispatch.ts";
import { useHost } from "../hooks.ts";
import {
  archiveCommand,
  permissionCommand,
  permissionModesOn,
  permissionLabel,
  renameCommand,
} from "../model/intent.ts";
import { waitingOn, waitingPhrase } from "../model/background.ts";
import { contextLabel } from "../model/meta.ts";
import { BackgroundTasksHover } from "./background.tsx";
import { ContextReadout } from "./ContextCard.tsx";
import { settingsStore } from "../../settings/index.ts";
import { useLeadConstellation } from "../../constellation/hooks.ts";

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
  const modes = permissionModesOn(useHost(hostKey)?.status.capabilities ?? []);

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
      <DropdownMenuContent align="end" className="min-w-52" onCloseAutoFocus={keepTerminalFocus}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Permissions
            <span className="text-caption text-text-subtle ml-auto pl-3">
              {permissionLabel(session.permissionMode)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={session.permissionMode}
              onValueChange={(mode) => {
                const found = modes.find((p) => p.mode === mode);

                if (found !== undefined) void setPermission(hostKey, session, found.mode);
              }}
            >
              {modes.map((p) => (
                <DropdownMenuRadioItem key={p.mode} value={p.mode}>
                  <span className="flex flex-col py-1">
                    <span>{p.label}</span>
                    <span className="text-caption text-text-subtle">{p.detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem needsInput disabled={!canFork} onSelect={onFork}>
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
                : archiveCommand(session.id, settingsStore.getState().sessions.deleteMergedBranch),
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
  const waiting = waitingOn(session);
  const lead = useLeadConstellation(hostKey, session.id) !== null;

  const state =
    waiting.length > 0
      ? waitingPhrase(waiting)
      : session.state === "limited"
        ? usageLimitLine(session.limitResetsAt)
        : capitalized(sessionStateLabel[session.state]);

  const context = contextLabel(session.contextUsage);

  const stateLine = (
    <span
      className={cn(
        "text-caption text-text-subtle tabular",
        waiting.length > 0 ? "min-w-0 truncate" : "shrink-0"
      )}
      data-testid="session-state"
    >
      {turnNumber === null || session.state === "limited" ? state : `${state} · turn ${turnNumber}`}
    </span>
  );

  return (
    <header className="border-hairline gap-row-x pt-panel flex shrink-0 flex-col border-b px-5 pb-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <Celestial
          body={sessionCelestial(session.celestial, lead)}
          harness={session.harness}
          size={24}
          working={session.state === "working"}
          dormant={session.state === "dormant" || session.state === "archived"}
          data-testid="session-celestial"
        />
        <div className="min-w-0 flex-1">
          <Title hostKey={hostKey} session={session} />
        </div>
        <SessionMenu {...props} />
      </div>
      <div className="flex min-w-0 items-center gap-3 whitespace-nowrap">
        {harness === null ? (
          <span className="text-label text-text-default">{session.harness}</span>
        ) : (
          <span className="text-label shrink-0" style={{ color: harnessTextVar(harness) }}>
            {harnessHue(harness).name}
          </span>
        )}
        {waiting.length > 0 ? (
          <BackgroundTasksHover tasks={waiting}>{stateLine}</BackgroundTasksHover>
        ) : (
          stateLine
        )}
        <span className="flex-1" />
        {context === null ? null : (
          <ContextReadout
            hostKey={hostKey}
            session={session}
            label={context.text}
            detail={context.detail}
            turnNumber={turnNumber}
          />
        )}
        <span className="text-caption text-text-subtle shrink-0 whitespace-nowrap">
          {permissionLabel(session.permissionMode)}
        </span>
      </div>
    </header>
  );
};
