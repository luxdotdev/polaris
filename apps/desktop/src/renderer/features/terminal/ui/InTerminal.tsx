/**
 * The session side of the hand-off: the "Open in terminal" menu item and, while
 * the session is In Terminal, a bar above the composer with "Take back".
 */
import type { SessionId, SessionState } from "@polaris/protocol";
import { Button, DropdownMenuItem, PixelTerminalIcon } from "@polaris/ui";
import { useState } from "react";
import { activateTab } from "../actions.ts";
import { claimFocusFromMenu } from "../focus.ts";
import { openInTerminal, takeBack } from "../handoff.ts";
import { loaded } from "../loaded.ts";
import { handoffKey, tabOf } from "../model/tabs.ts";
import { drawerKey, getDrawer, updateDrawer } from "../store.ts";

export interface HandoffSession {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly sessionId: SessionId;
  readonly state: SessionState;
  /** "Claude Code · Fix the flaky test": the hand-off tab's title. */
  readonly title: string;
}

/** Shows the session's hand-off tab if it is still there; otherwise runs its terminal UI again. */
const showOrOpen = (s: HandoffSession) => {
  const key = drawerKey(s.hostKey, s.workspaceId);
  const tab = tabOf(getDrawer(key), handoffKey(s.sessionId));

  if (tab !== undefined && tab.status.kind === "live") {
    updateDrawer(key, (d) => ({ ...d, open: true }));
    activateTab(s, tab.key);
    // Already mounted, the surface won't autofocus again; focus it once React has shown it.
    requestAnimationFrame(() => {
      if (tab.terminalId !== null) loaded.runtime?.focusTerminal(s.hostKey, tab.terminalId);
    });

    return Promise.resolve(true);
  }

  return openInTerminal(s, s.state === "in-terminal");
};

const canHandOff = (state: SessionState) => state !== "archived" && state !== "starting";

/** For the session header's menu. */
export const OpenInTerminalItem = ({ session }: { readonly session: HandoffSession }) => (
  <DropdownMenuItem
    disabled={!canHandOff(session.state)}
    onSelect={() => {
      claimFocusFromMenu();
      void showOrOpen(session);
    }}
    data-testid="open-in-terminal"
  >
    {session.state === "in-terminal" ? "Show terminal" : "Open in terminal"}
  </DropdownMenuItem>
);

/** Above the composer while the session is In Terminal. */
export const InTerminalBar = ({ session }: { readonly session: HandoffSession }) => {
  const [busy, setBusy] = useState(false);

  if (session.state !== "in-terminal") return null;

  const run = (action: () => Promise<boolean>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  return (
    <div
      className="border-hairline bg-surface-sunken mx-panel rounded-row mb-2 flex items-center gap-3 border px-3 py-2"
      data-testid="in-terminal"
    >
      <PixelTerminalIcon size={16} className="text-text-subtle shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-label text-text-default">In terminal</span>
        <span className="text-caption text-text-subtle truncate">
          Polaris follows along; take it back to send a turn
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => run(() => showOrOpen(session))}
      >
        Show terminal
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => run(() => takeBack(session))}
        data-testid="take-back"
      >
        Take back
      </Button>
    </div>
  );
};
