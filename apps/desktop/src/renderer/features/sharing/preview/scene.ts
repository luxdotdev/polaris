/**
 * Sharing on fixtures (Paper SS1–SS4), for the session preview (`#preview/<scene>`): the owner's
 * header and sheet, the signed-out sheet, and a Teammate's view of the same session with the
 * sidebar's Shared with you. No main process: the bridge answers from here.
 */
import { Sequence, type SessionId } from "@polaris/protocol";
import type { PolarisAccountsView } from "../../../../shared/accountsContract.ts";
import type { HostView, RequestInput, RequestMethod, Result } from "../../../../shared/api.ts";
import type {
  PresenceView,
  SharedWithMeView,
  ShareView,
} from "../../../../shared/sharingContract.ts";
import { modelFromSnapshot } from "../../../store/hostModel.ts";
import { type AppState, sessionKey } from "../../../store/store.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { openShareSheet } from "../ui/HeaderShare.tsx";

export const SHARING_SCENES = [
  /** SS3: the owner's share sheet, two people with access and the log. */
  "share-sheet",
  /** SS3's signed-out state. */
  "share-signed-out",
  /** SS2 and SS4: the same session as a Teammate, with an Invite and a Host offline. */
  "shared-teammate",
] as const;

export type SharingScene = (typeof SHARING_SCENES)[number];

export const isSharingScene = (scene: string): scene is SharingScene =>
  SHARING_SCENES.some((s) => s === scene);

/** The owner's Host as the Teammate reaches it. */
export const SHARED_HOST = "shared:lucas";

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const person = (login: string, name: string) => ({ login, name, avatar: null });

const lucas = person("lucasdoell", "Lucas Doell");

const maya = person("mchen", "Maya Chen");

const alex = person("arivera", "Alex Rivera");

const sam = person("sokafor", "Sam Okafor");

const account = (id: string, login: string, cloud: boolean) => ({
  id,
  server: cloud ? "https://auth.polaris.lux.dev" : "https://auth.acme.dev",
  serverLabel: cloud ? "Polaris Cloud" : "auth.acme.dev",
  isPolarisCloud: cloud,
  login,
  name: null,
  avatar: null,
  commitEmail: `${login}@acme.dev`,
  commitEmails: [`${login}@acme.dev`],
  signedInAt: Date.now() - 86_400_000,
  signedOutAt: null,
});

/** Signed out, the owner on Polaris Cloud, or the Teammate on two servers. */
const signedIn = (scene: string) => {
  if (scene === "share-signed-out") return [];

  if (scene === "shared-teammate")
    return [account("a1", "maya", true), account("a2", "maya-acme", false)];

  return [account("a1", "lucasdoell", true)];
};

const accounts = (scene: string): PolarisAccountsView => ({
  storageAvailable: true,
  accounts: signedIn(scene),
  workspaces: {},
  signIn: null,
  failure: null,
});

const SHARES: ReadonlyArray<ShareView> = [
  {
    id: "sh-maya",
    person: maya,
    role: "commenter",
    createdAt: minutesAgo(9000),
    expiresAt: daysAhead(2),
    revokedAt: null,
    live: true,
    log: [
      { kind: "invited", at: minutesAgo(9000), actor: "You", detail: "commenter" },
      { kind: "accepted", at: minutesAgo(8900), actor: "Maya Chen", detail: null },
      { kind: "renewed", at: minutesAgo(3000), actor: "You", detail: null },
      { kind: "device-added", at: minutesAgo(31), actor: null, detail: "MacBook Air" },
    ],
  },
  {
    id: "sh-alex",
    person: alex,
    role: "commenter",
    createdAt: minutesAgo(41),
    expiresAt: daysAhead(6),
    revokedAt: null,
    live: true,
    log: [
      { kind: "invited", at: minutesAgo(41), actor: "You", detail: "commenter" },
      { kind: "accepted", at: minutesAgo(39), actor: "Alex Rivera", detail: null },
    ],
  },
  {
    id: "sh-sam",
    person: sam,
    role: "commenter",
    createdAt: minutesAgo(20),
    expiresAt: daysAhead(7),
    revokedAt: null,
    live: true,
    log: [{ kind: "invited", at: minutesAgo(20), actor: "You", detail: "commenter" }],
  },
];

const PRESENCE: ReadonlyArray<PresenceView> = [
  { key: "maya", person: maya, isOwner: false, since: minutesAgo(12) },
  { key: "alex", person: alex, isOwner: false, since: minutesAgo(5) },
  { key: "lucas", person: lucas, isOwner: true, since: minutesAgo(40) },
  { key: "sam", person: sam, isOwner: false, since: minutesAgo(1) },
];

const withMe = (sessionId: string): SharedWithMeView => ({
  invites: [
    {
      accountId: "a2",
      inviteId: "inv-1",
      owner: person("pshah", "Priya Shah"),
      title: "Billing export retry",
      hostName: "Linux VM",
      role: "commenter",
      expiresAt: daysAhead(7),
      commitEmail: "maya@acme.dev",
    },
  ],
  sessions: [
    {
      accountId: "a1",
      hostKey: SHARED_HOST,
      sessionId,
      title: "Orchestrator layouts",
      owner: lucas,
      hostName: "Mac Studio",
      role: "commenter",
      hostOffline: false,
      ended: false,
    },
    {
      accountId: "a2",
      hostKey: "shared:dev",
      sessionId: "s-flaky",
      title: "Flaky e2e triage",
      owner: person("dpatel", "Dev Patel"),
      hostName: "Linux VM",
      role: "commenter",
      hostOffline: true,
      ended: false,
    },
  ],
  accounts: [
    { id: "a1", login: "maya" },
    { id: "a2", login: "maya-acme" },
  ],
});

/** The sharing feeds: Polaris accounts, Shared with you, and who has the session open. */
export const sharingFeed = (
  scene: string,
  kind: string,
  sessionId: string
): ReadonlyArray<unknown> | null => {
  if (kind === "accounts") return [accounts(scene)];

  if (kind === "sharing.withMe")
    return [
      scene === "shared-teammate" ? withMe(sessionId) : { invites: [], sessions: [], accounts: [] },
    ];

  if (kind === "sharing.presence")
    return [scene === "shared-teammate" ? PRESENCE.slice(2) : PRESENCE];

  return null;
};

/** The sharing requests: a login the server doesn't know is refused, as `sharing.share` does. */
export const sharingAnswer = (
  method: RequestMethod,
  input: RequestInput<RequestMethod>,
  sessionId: string
): Result<unknown> | null => {
  if (method === "sharing.sharedSessions") return { ok: true, value: [sessionId] };

  if (method === "sharing.list") return { ok: true, value: SHARES };

  if (method === "sharing.share") {
    const login = "login" in input ? String(input.login) : "";

    return login === "arikow"
      ? { ok: false, error: { code: "PersonNotFound", message: "" } }
      : { ok: true, value: SHARES[0] };
  }

  if (method === "sharing.renew" || method === "sharing.revoke")
    return { ok: true, value: SHARES[0] };

  return method.startsWith("sharing.") || method.startsWith("accounts.")
    ? { ok: true, value: null }
    : null;
};

/** For the Teammate: the shared session lives on the owner's Host, not yours. */
export const teammateState = (
  state: AppState,
  shared: SessionModel,
  ownHost: HostView
): AppState => {
  if (shared.session === null) return state;

  const id = shared.session.id;
  const ownKey = ownHost.key;
  const own = state.hostModels[ownKey];

  const theirs: HostView = {
    ...ownHost,
    key: SHARED_HOST,
    label: "Mac Studio",
    kind: "relay",
    shared: true,
  };

  const sessions = new Map(own?.sessions);

  sessions.delete(id);
  const hostModels = { ...state.hostModels };

  if (own !== undefined) hostModels[ownKey] = { ...own, sessions };

  return {
    ...state,
    sharedHosts: [theirs],
    hostModels: {
      ...hostModels,
      [SHARED_HOST]: {
        ...modelFromSnapshot({
          sequence: Sequence.make(90),
          workspaces: [],
          worktrees: [],
          sessions: [
            {
              session: shared.session,
              pendingApprovals: shared.pendingApprovals,
              lastTurnPreview: null,
              subagents: [],
            },
          ],
        }),
        synchronized: true,
      },
    },
    sessions: { ...state.sessions, [sessionKey(SHARED_HOST, id)]: shared },
  };
};

/** After mounting: open the sheet, or the session shared with you. */
export const startSharingScene = (
  scene: SharingScene,
  hostKey: string,
  sessionId: SessionId,
  select: (target: { readonly hostKey: string; readonly sessionId: SessionId }) => void
) => {
  if (scene === "shared-teammate") select({ hostKey: SHARED_HOST, sessionId });
  else openShareSheet({ hostKey, sessionId });
};
