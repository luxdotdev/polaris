/**
 * The sidebar's Shared with you (Paper SS4; DESIGN.md, Shared Sessions): Invites first, with
 * Open and Decline and the commit email that will credit you, then the sessions others shared
 * with you, grouped by owner. Hidden while there are none (rule/solo-is-unchanged).
 */
import { SessionId } from "@polaris/protocol";
import { Button, cn, Row, SectionHeader } from "@polaris/ui";
import { useState } from "react";
import type { InviteView, SharedSessionView } from "../../../../shared/sharingContract.ts";
import { age, sessionStateLabel } from "../../../shell/copy.ts";
import { SessionGlyph } from "../../../shell/glyphs.tsx";
import { useApp, useConnection, useSelection, useShellActions } from "../../../shell/hooks.ts";
import { buttonProps } from "../../../shell/sidebar/SessionRow.tsx";
import { useNow } from "../../../shell/useNow.ts";
import { shownState } from "../../../routes/topBar.ts";
import { polaris } from "../../bridge.ts";
import { useSharedWithMe } from "../data/feeds.ts";
import { inviteFrom, ownerGroups, roleLabel, sharedLine } from "../model/copy.ts";
import { PersonAvatar } from "./Avatar.tsx";

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** How long a just-accepted session may take to reach the Host list before it opens. */
const OPEN_WAIT_MS = 15_000;

/** Opens a shared session once main lists its Host as shared, so it opens in the pane. */
const useOpenShared = () => {
  const { store } = useConnection();
  const { selectSession } = useShellActions();

  return (hostKey: string, sessionId: SessionId) => {
    const ready = () => store.getState().sharedHosts.some((h) => h.key === hostKey);

    if (ready()) {
      selectSession({ hostKey, sessionId });

      return;
    }

    const off = store.subscribe(() => {
      if (!ready()) return;
      off();
      clearTimeout(timer);
      selectSession({ hostKey, sessionId });
    });

    const timer = setTimeout(off, OPEN_WAIT_MS);
  };
};

const InviteCard = ({ invite }: { readonly invite: InviteView }) => {
  const open = useOpenShared();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const accept = () => {
    setBusy(true);
    setFailure(null);
    void polaris()
      .request("sharing.invite.accept", { accountId: invite.accountId, inviteId: invite.inviteId })
      .then((result) => {
        setBusy(false);

        if (result.ok) open(result.value.hostKey, SessionId.make(result.value.sessionId));
        else setFailure(result.error.message || "Couldn't open this invite.");
      });
  };

  const decline = () =>
    void polaris().request("sharing.invite.decline", {
      accountId: invite.accountId,
      inviteId: invite.inviteId,
    });

  return (
    <div
      className="border-hairline bg-surface-raised mx-1 flex gap-2.5 rounded-[10px] border p-3"
      data-testid="share-invite"
    >
      <PersonAvatar person={invite.owner} size={20} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body text-text-default">
          {inviteFrom(invite.owner)} shared{" "}
          <span className="text-text-strong font-medium">{invite.title}</span> with you
        </p>
        <p className="text-caption text-text-subtle">
          {roleLabel(invite.role)} · until {shortDate(invite.expiresAt)}
        </p>
        <p className="text-caption text-text-subtle">
          Accepting credits your commits to {invite.commitEmail}.
        </p>
        {failure === null ? null : <p className="text-caption text-failed-text">{failure}</p>}
        <div className="flex items-center gap-1 pt-1">
          <Button variant="primary" size="xs" disabled={busy} onClick={accept}>
            Open
          </Button>
          <Button variant="ghost" size="xs" disabled={busy} onClick={decline}>
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
};

const SharedRow = ({ view, now }: { readonly view: SharedSessionView; readonly now: number }) => {
  const { selectSession } = useShellActions();
  const { shared } = useSelection();
  const sessionId = SessionId.make(view.sessionId);

  const entry = useApp((s) => s.hostModels[view.hostKey]?.sessions.get(sessionId));
  const selected = shared?.hostKey === view.hostKey && shared.sessionId === sessionId;
  const state = entry === undefined ? null : shownState(entry);
  const gone = view.hostOffline || view.ended;

  return (
    <Row
      {...buttonProps(() => selectSession({ hostKey: view.hostKey, sessionId }))}
      aria-current={selected}
      data-testid="shared-session"
      variant="session"
      selected={selected}
      tone={gone ? "quiet" : "default"}
      leading={
        <span className={cn("flex size-4 items-center justify-center", gone && "opacity-50")}>
          <SessionGlyph
            state={gone || state === null ? "dormant" : state}
            harness={entry?.session.harness ?? "claude"}
            size={14}
          />
        </span>
      }
      title={
        <span className={cn(gone && "text-text-subtle")}>
          {entry?.session.title || view.title || "Untitled session"}
        </span>
      }
      description={sharedLine(view, state === null ? null : capitalized(sessionStateLabel[state]))}
      meta={entry === undefined ? undefined : age(entry.session.createdAt, now)}
    />
  );
};

export const SharedWithYou = () => {
  const view = useSharedWithMe();
  const now = useNow();

  if (view === null || view.invites.length + view.sessions.length === 0) return null;
  const groups = ownerGroups(view.sessions, view.accounts);

  return (
    <div className="flex flex-col gap-1 px-2 pt-3" data-testid="shared-with-you">
      <SectionHeader>Shared with you · {view.invites.length + view.sessions.length}</SectionHeader>
      {view.invites.map((invite) => (
        <InviteCard key={`${invite.accountId}:${invite.inviteId}`} invite={invite} />
      ))}
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col">
          <div className="text-caption text-text-subtle flex h-7 items-center gap-1.5 px-2">
            <PersonAvatar person={group.owner} size={16} />
            <span className="truncate">{group.owner.name ?? `@${group.owner.login}`}</span>
            {group.via === null ? null : <span className="text-text-faint">· via {group.via}</span>}
          </div>
          {group.sessions.map((session) => (
            <SharedRow key={`${session.hostKey}:${session.sessionId}`} view={session} now={now} />
          ))}
        </div>
      ))}
    </div>
  );
};
