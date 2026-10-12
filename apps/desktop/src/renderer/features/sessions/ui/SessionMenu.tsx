/**
 * A session row's right-click menu (C9, Paper 12): Pin to top or Unpin, Rename…, Open in
 * Review, Copy session ID, Archive. Rename edits the row's title in place.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Input,
} from "@polaris/ui";
import { type ComponentProps, type ReactElement, useRef, useState } from "react";
import { Commands } from "../../../commands.ts";
import { openSessionReview } from "../../../routes/review.ts";
import { useShellActions } from "../../../shell/hooks.ts";
import type { SessionEntry } from "../../../store/hostModel.ts";
import { writeClipboard } from "../../clipboard.ts";
import { send } from "../../session/dispatch.ts";
import { hasCapability, useHost } from "../../session/hooks.ts";
import { archiveCommand, renameCommand } from "../../session/model/intent.ts";
import { settingsStore } from "../../settings/index.ts";
import { isReviewSession } from "../model/sections.ts";

/** A hover card's trigger around the menu passes its props through to the row. */
export interface SessionMenuProps extends Omit<
  ComponentProps<typeof ContextMenuTrigger>,
  "asChild" | "children"
> {
  readonly hostKey: string;
  readonly entry: SessionEntry;
  readonly onRename: () => void;
  readonly children: ReactElement;
}

/** Whether the menu offers Open in Review: the session has Turns of its own to review. */
const reviewable = (entry: SessionEntry) =>
  entry.session.turnCount > 0 && !isReviewSession(entry.session);

export const SessionMenu = ({ hostKey, entry, onRename, children, ...slot }: SessionMenuProps) => {
  const actions = useShellActions();
  const canPin = hasCapability(useHost(hostKey), "session.pin");
  const { session } = entry;
  const pinned = session.pinnedAt != null;
  const archived = session.state === "archived";
  // Closing the menu refocuses the row, which would blur the rename field at once.
  const renamingNext = useRef(false);

  const pin = () =>
    void send(
      hostKey,
      Commands.PinSession({ sessionId: session.id, pinned: !pinned }),
      pinned ? "Couldn't unpin" : "Couldn't pin"
    );

  const review = () => {
    actions.selectSession({ hostKey, sessionId: session.id });
    openSessionReview(actions, hostKey, session.id);
  };

  const archive = () =>
    void send(
      hostKey,
      archived
        ? Commands.UnarchiveSession({ sessionId: session.id })
        : archiveCommand(session.id, settingsStore.getState().sessions.deleteMergedBranch),
      archived ? "Couldn't unarchive" : "Couldn't archive"
    );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild {...slot}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-52"
        data-testid="session-context-menu"
        onCloseAutoFocus={(event) => {
          if (renamingNext.current) event.preventDefault();
          renamingNext.current = false;
        }}
      >
        {canPin ? (
          <ContextMenuItem onSelect={pin}>{pinned ? "Unpin" : "Pin to top"}</ContextMenuItem>
        ) : null}
        <ContextMenuItem
          needsInput
          onSelect={() => {
            renamingNext.current = true;
            onRename();
          }}
        >
          Rename…
        </ContextMenuItem>
        {reviewable(entry) ? (
          <ContextMenuItem onSelect={review}>Open in Review</ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => void writeClipboard(session.id)}>
          Copy session ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={archive}>{archived ? "Unarchive" : "Archive"}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

/** The row's title while it is being renamed: Enter saves, Esc or leaving it cancels. */
export const RenameField = ({
  hostKey,
  entry,
  onDone,
}: {
  readonly hostKey: string;
  readonly entry: SessionEntry;
  readonly onDone: () => void;
}) => {
  const [text, setText] = useState(entry.session.title);

  const commit = () => {
    const command = renameCommand(entry.session.id, text);

    onDone();

    if (command !== null && text.trim() !== entry.session.title)
      void send(hostKey, command, "Couldn't rename");
  };

  return (
    <Input
      autoFocus
      aria-label="Session title"
      value={text}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setText(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={onDone}
      onKeyDown={(event) => {
        // The row is a button: keep Space, Enter and the arrows inside the field.
        event.stopPropagation();

        if (event.key === "Enter") commit();
        else if (event.key === "Escape") onDone();
      }}
      className="h-6"
    />
  );
};

/** A row's rename state, shared by its menu and its title. */
export const useRenaming = () => {
  const [renaming, setRenaming] = useState(false);

  return { renaming, start: () => setRenaming(true), stop: () => setRenaming(false) };
};
