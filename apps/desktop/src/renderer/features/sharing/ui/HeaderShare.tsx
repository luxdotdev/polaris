/**
 * The session header's sharing (Paper SS1, SS2): who has it open, then Share for your own
 * session or your role for one shared with you. A session never shared shows only Share
 * (DESIGN.md, rule/solo-is-unchanged).
 */
import type { SessionId } from "@polaris/protocol";
import { Button, Tooltip, TooltipContent, TooltipTrigger, UsersIcon } from "@polaris/ui";
import { useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PresenceView } from "../../../../shared/sharingContract.ts";
import { useApp } from "../../../shell/hooks.ts";
import { usePolarisAccounts } from "../../accounts/index.ts";
import { useIsShared, usePresence, useSharedWithMe } from "../data/feeds.ts";
import { personName, roleLabel } from "../model/copy.ts";
import { PersonAvatar } from "./Avatar.tsx";
import { ShareDialog } from "./ShareDialog.tsx";

/** The session whose share sheet is open; null when closed. */
export interface ShareSheetTarget {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

const sheet = createStore<{ readonly open: ShareSheetTarget | null }>(() => ({ open: null }));

/** Opens the share sheet (the Share button; the preview opens it to screenshot SS3). */
export const openShareSheet = (target: ShareSheetTarget) => sheet.setState({ open: target });

export const closeShareSheet = () => sheet.setState({ open: null });

/** Presence shows two avatars, then "+N". */
const SHOWN = 2;

const PresenceRow = ({ people }: { readonly people: ReadonlyArray<PresenceView> }) => {
  if (people.length === 0) return null;
  const rest = people.length - SHOWN;

  return (
    <div className="flex shrink-0 items-center gap-[3px] pr-0.5" data-testid="session-presence">
      {people.slice(0, SHOWN).map((entry) => (
        <Tooltip key={entry.key}>
          <TooltipTrigger asChild>
            <span aria-label={`${personName(entry.person)} has this session open`}>
              <PersonAvatar person={entry.person} size={24} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{personName(entry.person)} · viewing</TooltipContent>
        </Tooltip>
      ))}
      {rest > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="bg-fill-selected text-micro text-text-subtle flex h-6 items-center rounded-full px-1.5 font-medium">
              +{rest}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {people
              .slice(SHOWN)
              .map((p) => personName(p.person))
              .join(", ")}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
};

/** Leaves out whoever is looking: the owner's own devices, and any of your Polaris accounts. */
const useOthers = (people: ReadonlyArray<PresenceView>, owner: boolean) => {
  const accounts = usePolarisAccounts();

  return useMemo(() => {
    const mine = new Set((accounts?.accounts ?? []).map((a) => a.login.toLowerCase()));

    return people.filter((p) => !(owner && p.isOwner) && !mine.has(p.person.login.toLowerCase()));
  }, [people, owner, accounts]);
};

/** Your role in a session shared with you; undefined in your own sessions. */
export const useSharedRole = (hostKey: string, sessionId: string) =>
  useSharedWithMe()?.sessions.find((s) => s.hostKey === hostKey && s.sessionId === sessionId)?.role;

/** Your role in a session shared with you, where the owner sees Share. */
const RoleChip = ({ hostKey, sessionId }: ShareSheetTarget) => {
  const role = useSharedRole(hostKey, sessionId);

  if (role === undefined) return null;

  return (
    <span
      className="border-hairline text-caption text-text-default flex h-7 shrink-0 items-center rounded-full border px-3"
      data-testid="share-role"
    >
      {roleLabel(role)}
    </span>
  );
};

const TeammateShare = ({ hostKey, sessionId }: ShareSheetTarget) => {
  const people = useOthers(usePresence(hostKey, sessionId, true), false);

  return (
    <>
      <PresenceRow people={people} />
      <RoleChip hostKey={hostKey} sessionId={sessionId} />
    </>
  );
};

const OwnerShare = ({
  hostKey,
  sessionId,
  workspaceId,
  title,
}: ShareSheetTarget & { readonly workspaceId: string; readonly title: string }) => {
  const shared = useIsShared(hostKey, sessionId);
  const people = useOthers(usePresence(hostKey, sessionId, shared), true);
  const open = useStore(sheet, (s) => s.open);
  const isOpen = open?.hostKey === hostKey && open.sessionId === sessionId;

  return (
    <>
      <PresenceRow people={people} />
      <Button
        className="shrink-0 gap-1.5 rounded-full pr-3 pl-2.5"
        data-testid="share-session"
        onClick={() => openShareSheet({ hostKey, sessionId })}
      >
        <UsersIcon size={14} />
        Share
      </Button>
      <ShareDialog
        open={isOpen}
        onClose={closeShareSheet}
        hostKey={hostKey}
        sessionId={sessionId}
        workspaceId={workspaceId}
        title={title}
      />
    </>
  );
};

/** Whether the session is on another person's Host, shared with you. */
export const useOnSharedHost = (hostKey: string): boolean =>
  useApp((s) => s.sharedHosts.some((h) => h.key === hostKey));

export const HeaderShare = (props: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly workspaceId: string;
  readonly title: string;
}) =>
  useOnSharedHost(props.hostKey) ? (
    <TeammateShare hostKey={props.hostKey} sessionId={props.sessionId} />
  ) : (
    <OwnerShare {...props} />
  );
