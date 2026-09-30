/**
 * The Needs You inbox across every Host (DESIGN.md, Needs You inbox): sessions waiting on an
 * approval or a question, oldest first; then "Also waiting on you" (Failed, In Terminal, an
 * Interrupted Turn after a restart); and answers another device gave. Pure, so it is tested.
 */
import type { ApprovalRequest } from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { needsYou } from "../../../routes/topBar.ts";
import type { HostModel, ResolvedApproval, SessionEntry } from "../../../store/hostModel.ts";

export interface Place {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly workspace: string | null;
}

export interface WaitingSession extends Place {
  readonly key: string;
  readonly entry: SessionEntry;
  /** Its approvals and questions, oldest first; the first is the one to answer now. */
  readonly requests: ReadonlyArray<ApprovalRequest>;
  /** When the oldest request opened. */
  readonly since: string;
}

export type AlsoKind = "failed" | "in-terminal" | "interrupted";

export interface AlsoWaiting extends Place {
  readonly key: string;
  readonly entry: SessionEntry;
  readonly kind: AlsoKind;
}

export interface AnsweredElsewhere extends Place {
  readonly key: string;
  readonly entry: SessionEntry;
  readonly resolution: ResolvedApproval;
}

export interface Inbox {
  readonly waiting: ReadonlyArray<WaitingSession>;
  readonly also: ReadonlyArray<AlsoWaiting>;
  readonly answered: ReadonlyArray<AnsweredElsewhere>;
  /** Sessions that need you on every Host: the badge, menu bar and Dock count. */
  readonly count: number;
}

export interface InboxInput {
  readonly hosts: ReadonlyArray<HostView>;
  readonly models: Readonly<Record<string, HostModel>>;
  readonly now: number;
  /** Requests this device answered, so their resolution isn't news. */
  readonly answeredHere: ReadonlySet<string>;
}

/** Failed first (Paper 1G2-0), then what Continue picks up, then what's in a terminal. */
const ALSO_ORDER: Record<AlsoKind, number> = { failed: 0, interrupted: 1, "in-terminal": 2 };

/** How long "Answered on <device>" stays in the inbox. */
export const ANSWERED_FOR_MS = 60_000;

/** Pre-event logs recorded withdrawals as resolutions by these; they aren't another device. */
const NOT_A_DEVICE = new Set(["Harness", "Daemon"]);

export const inboxKey = (hostKey: string, sessionId: string) => `${hostKey}\u0000${sessionId}`;

const alsoKind = (entry: SessionEntry): AlsoKind | null => {
  const { state } = entry.session;

  if (state === "failed") return "failed";

  if (state === "in-terminal") return "in-terminal";

  // Needs You with nothing pending: a Turn interrupted by a Daemon restart, waiting on Continue.
  return state === "needs-you" && entry.pendingApprovals.length === 0 ? "interrupted" : null;
};

const byOpened = (a: ApprovalRequest, b: ApprovalRequest) => a.openedAt.localeCompare(b.openedAt);

interface Collected {
  readonly waiting: Array<WaitingSession>;
  readonly also: Array<AlsoWaiting>;
  readonly answered: Array<AnsweredElsewhere>;
}

interface ResolutionsInput {
  readonly place: Place;
  readonly key: string;
  readonly entry: SessionEntry;
  readonly input: InboxInput;
}

/** A session's recent answers that came from another device. */
const answeredElsewhere = ({ place, key, entry, input }: ResolutionsInput) =>
  (entry.resolved ?? []).flatMap((resolution): Array<AnsweredElsewhere> => {
    const fresh = input.now - Date.parse(resolution.at) < ANSWERED_FOR_MS;

    const elsewhere =
      !input.answeredHere.has(resolution.request.id) && !NOT_A_DEVICE.has(resolution.resolvedBy);

    return fresh && elsewhere
      ? [{ ...place, key: `${key}\u0000${resolution.request.id}`, entry, resolution }]
      : [];
  });

interface HostInput {
  readonly host: HostView;
  readonly model: HostModel;
  readonly input: InboxInput;
  readonly into: Collected;
}

const collectHost = ({ host, model, input, into }: HostInput) => {
  for (const entry of model.sessions.values()) {
    if (entry.session.state === "archived") continue;

    const place: Place = {
      hostKey: host.key,
      hostLabel: host.label,
      workspace: model.workspaces.get(entry.session.workspaceId)?.name ?? null,
    };

    const key = inboxKey(host.key, entry.session.id);

    const requests = [...new Map(entry.pendingApprovals.map((r) => [r.id, r])).values()].sort(
      byOpened
    );

    const first = requests[0];

    if (first !== undefined)
      into.waiting.push({ ...place, key, entry, requests, since: first.openedAt });
    const kind = first === undefined ? alsoKind(entry) : null;

    if (kind !== null) into.also.push({ ...place, key, entry, kind });

    into.answered.push(...answeredElsewhere({ place, key, entry, input }));
  }
};

export const buildInbox = (input: InboxInput): Inbox => {
  const into: Collected = { waiting: [], also: [], answered: [] };
  let count = 0;

  for (const host of input.hosts) {
    const model = input.models[host.key];

    if (model === undefined) continue;
    collectHost({ host, model, input, into });

    for (const entry of model.sessions.values()) {
      if (entry.session.state !== "archived" && needsYou(entry)) count++;
    }
  }

  return {
    waiting: into.waiting.sort((a, b) => a.since.localeCompare(b.since)),
    also: into.also.sort(
      (a, b) =>
        ALSO_ORDER[a.kind] - ALSO_ORDER[b.kind] ||
        b.entry.session.updatedAt.localeCompare(a.entry.session.updatedAt)
    ),
    answered: into.answered.sort((a, b) => b.resolution.at.localeCompare(a.resolution.at)),
    count,
  };
};
