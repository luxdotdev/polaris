/**
 * The long-press menus (ENG-490): the Desktop App's right-click menus for the same items, cut to
 * what a Linked Device may send (`DEVICE_COMMANDS`) and what means something on a phone.
 */
import type { ApprovalRequest, Command, ConnectionState } from "@polaris/protocol";
import type { Session } from "../home/feed/fold.ts";
import type { ConstellationRow, SessionRow } from "../home/model/home.ts";
import { approvalDetail } from "../home/model/lines.ts";
import { type Reply, respondCommand } from "../home/model/respond.ts";

export type MenuAction =
  | { readonly kind: "open-session"; readonly hostId: string; readonly sessionId: string }
  | { readonly kind: "open-review"; readonly hostId: string; readonly sessionId: string }
  | {
      readonly kind: "open-constellation";
      readonly hostId: string;
      readonly constellationId: string;
    }
  | {
      readonly kind: "reply";
      readonly hostId: string;
      readonly approval: ApprovalRequest;
      readonly reply: Reply;
    }
  | { readonly kind: "copy"; readonly text: string }
  | { readonly kind: "retry-host"; readonly hostId: string };

export interface MenuItem {
  /** Unique within its menu: what the native menu hands back when it is chosen. */
  readonly id: string;
  readonly title: string;
  /** Under the title; says why a disabled item is disabled. */
  readonly subtitle: string | null;
  readonly disabled: boolean;
  readonly action: MenuAction;
}

/** Groups of items; the native menu draws a separator between groups. */
export type Menu = ReadonlyArray<ReadonlyArray<MenuItem>>;

const item = (id: string, title: string, action: MenuAction): MenuItem => ({
  id,
  title,
  subtitle: null,
  disabled: false,
  action,
});

/** Reviewer and walkthrough sessions, as the Desktop App's sidebar tells them apart. */
const isReviewSession = (session: Session) =>
  session.origin != null ||
  /[/\\]\.review[/\\]/u.test(session.cwd) ||
  session.title.startsWith("Reviewer · ") ||
  session.title.startsWith("Walkthrough · ");

/** The Desktop App's "Open in Review": the session has Turns of its own to review. */
export const reviewable = (session: Session) => session.turnCount > 0 && !isReviewSession(session);

const opens = (hostId: string, session: Session): ReadonlyArray<MenuItem> => [
  item("open-session", "Open agent session", {
    kind: "open-session",
    hostId,
    sessionId: session.id,
  }),
  ...(reviewable(session)
    ? [item("open-review", "Open review", { kind: "open-review", hostId, sessionId: session.id })]
    : []),
];

const copyId = (session: Session): MenuItem =>
  item("copy-id", "Copy agent session ID", { kind: "copy", text: session.id });

const ANSWERS: ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly reply: Reply;
}> = [
  { id: "approve", title: "Approve", reply: { kind: "approve" } },
  { id: "always", title: "Always here", reply: { kind: "always" } },
  { id: "deny", title: "Deny", reply: { kind: "deny" } },
];

/**
 * A permission request's answers, as the Needs You card's menu offers them. A question is
 * answered in words, and a command too long to show inline only in the agent session.
 */
const answers = (row: SessionRow): ReadonlyArray<MenuItem> => {
  const { approval } = row;

  if (approval === null || approval.kind === "question") return [];

  if (approvalDetail(approval)?.tooLong === true) return [];

  return ANSWERS.map(({ id, title, reply }) => ({
    ...item(id, title, { kind: "reply", hostId: row.hostId, approval, reply }),
    subtitle: row.stale ? "Host offline" : null,
    disabled: row.stale,
  }));
};

/** An agent session's row on Home or in the Review tab. */
export const sessionMenu = (row: SessionRow): Menu =>
  [opens(row.hostId, row.session), answers(row), [copyId(row.session)]].filter(
    (group) => group.length > 0
  );

/** A constellation's row: the constellation, then its lead's own items. */
export const constellationMenu = (row: ConstellationRow): Menu => {
  const open = item("open-constellation", "Open constellation", {
    kind: "open-constellation",
    hostId: row.hostId,
    constellationId: row.constellation.id,
  });

  const { lead } = row;

  if (lead === null) return [[open]];

  return [
    [
      open,
      ...(reviewable(lead)
        ? [
            item("open-review", "Open review", {
              kind: "open-review",
              hostId: row.hostId,
              sessionId: lead.id,
            }),
          ]
        : []),
    ],
    [copyId(lead)],
  ];
};

/** A Host's row: Retry now while it isn't connected; nothing to offer otherwise. */
export const hostMenu = (host: {
  readonly hostId: string;
  readonly state: ConnectionState;
}): Menu =>
  host.state === "connected"
    ? []
    : [[item("retry", "Retry now", { kind: "retry-host", hostId: host.hostId })]];

/** The Daemon command an action sends, or null for one that stays on the phone. */
export const commandOf = (action: MenuAction): Command | null =>
  action.kind === "reply" ? replyCommand(action) : null;

export const replyCommand = (action: Extract<MenuAction, { readonly kind: "reply" }>): Command =>
  respondCommand(action.approval, action.reply);

/** The alert's title when a reply the menu sent is refused. */
export const failureTitle = (reply: Reply): string =>
  reply.kind === "deny" ? "Couldn't deny" : "Couldn't approve";
