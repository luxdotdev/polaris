/**
 * User access copy (ENG-927, ADR 0114; DESIGN.md, Settings → Hosts, Desktop apps): what an
 * enrolled desktop app is asked, what a waiting one is told, and each enrolled app's caption.
 */
import type {
  EnrolledAppView,
  UserAccessRequestView,
  UserAccessView,
} from "../../../shared/userAccessContract.ts";
import { ago } from "../machines/model.ts";

export const CAPABILITY = "user-access.enrolment";

/** "Allow MacBook Pro on Mac Studio?" */
export const requestTitle = (request: UserAccessRequestView, host: string) =>
  `Allow ${request.label} on ${host}?`;

/** The code that ties the request to the app that made it, first; then what allowing gives. */
export const requestBody = (request: UserAccessRequestView, host: string) =>
  `Only if it shows ${request.code}. It can then approve, send turns and start agent sessions on ${host}.`;

export interface Notice {
  readonly title: string;
  readonly body: string;
  /** The code the allowing app shows too; null when there is nothing to compare. */
  readonly code: string | null;
}

/** What this desktop app says while it can't approve on a host; null when it holds user access. */
export const noticeOf = (state: UserAccessView | undefined, host: string): Notice | null => {
  if (state === undefined || state.standing === "held") return null;

  if (state.standing === "waiting")
    return {
      title: `This desktop app is waiting to be allowed on ${host}`,
      body: `Until then it can't approve, send turns or start agent sessions there. Allow it from a desktop app that already uses ${host}; it shows the same code.`,
      code: state.code,
    };

  return {
    title: `This desktop app isn't allowed on ${host}`,
    body: `It can't approve, send turns or start agent sessions there. Reconnect to ${host} to ask again.`,
    code: null,
  };
};

/** "This desktop app · allowed 3d ago", "connected · allowed just now", "allowed 2h ago". */
export const enrolledCaption = (app: EnrolledAppView, now: number) => {
  const at = Date.parse(app.enrolledAt);
  const allowed = Number.isNaN(at) ? "allowed" : `allowed ${ago(now - at)}`;

  if (app.self) return `This desktop app · ${allowed}`;

  return app.connected ? `Connected · ${allowed}` : allowed;
};

/** What revoking does, said before it happens. */
export const revokeConsequence = (app: EnrolledAppView, host: string) =>
  app.self
    ? `This desktop app stops approving, sending turns and starting agent sessions on ${host} now. Another one has to allow it again.`
    : `${app.label} stops approving, sending turns and starting agent sessions on ${host} now. It can ask again.`;

/** "2 allowed", "2 allowed · 1 asking". */
export const cardAside = (state: UserAccessView) => {
  const allowed = `${state.enrolled.length} allowed`;

  return state.requests.length === 0 ? allowed : `${allowed} · ${state.requests.length} asking`;
};
