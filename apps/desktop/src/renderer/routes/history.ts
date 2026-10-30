/**
 * Page history: the sessions and Review subjects shown in this window, in order,
 * so Back and Forward (the mouse's side buttons, ⌘[ and ⌘]) move through them
 * like pages. Edit keeps its own history of places (`editPlaces`).
 */
import type { SessionId } from "@polaris/protocol";
import type { ReviewSubject } from "./review.ts";

export interface SessionPage {
  readonly kind: "session";
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

/** Review, on a subject or on the pull request list (null). */
export interface ReviewPage {
  readonly kind: "review";
  readonly subject: ReviewSubject | null;
}

export type Page = SessionPage | ReviewPage;

export interface PageHistory {
  readonly pages: ReadonlyArray<Page>;
  /** The page shown last; -1 before any. */
  readonly index: number;
}

export const HISTORY_LIMIT = 100;

export const emptyHistory: PageHistory = { pages: [], index: -1 };

const subjectKey = (subject: ReviewSubject | null) => {
  if (subject === null) return "list";

  if (subject.kind === "session")
    return `session\u0000${subject.hostKey}\u0000${subject.sessionId}`;
  const { repo, number } = subject.pull;

  return `pull\u0000${repo.host ?? ""}\u0000${repo.owner}/${repo.name}#${number}`;
};

const pageKey = (page: Page) =>
  page.kind === "session"
    ? `session\u0000${page.hostKey}\u0000${page.sessionId}`
    : `review\u0000${subjectKey(page.subject)}`;

export const samePage = (a: Page | undefined, b: Page | undefined) =>
  a !== undefined && b !== undefined && pageKey(a) === pageKey(b);

/** Showing `page`: the forward pages go, as in a browser; the page already current changes nothing. */
export const visit = (history: PageHistory, page: Page): PageHistory => {
  if (samePage(history.pages[history.index], page)) return history;

  const pages = [...history.pages.slice(0, history.index + 1), page].slice(-HISTORY_LIMIT);

  return { pages, index: pages.length - 1 };
};

/** The nearest page `step` away that still `exists`, and the history moved onto it; null when none. */
export const travel = (
  history: PageHistory,
  step: 1 | -1,
  exists: (page: Page) => boolean
): { readonly history: PageHistory; readonly page: Page } | null => {
  for (let i = history.index + step; i >= 0 && i < history.pages.length; i += step) {
    const page = history.pages[i];

    if (page !== undefined && exists(page)) return { history: { ...history, index: i }, page };
  }

  return null;
};

export interface BackForward {
  readonly back: () => void;
  readonly forward: () => void;
  readonly canGoBack: () => boolean;
  readonly canGoForward: () => boolean;
}

export interface PagesInput {
  /** The page on the stage; undefined while it shows something else (new session, Settings, Edit). */
  readonly shown: () => Page | undefined;
  /** False for a session that is gone or archived. */
  readonly live: (page: Page) => boolean;
  readonly open: (page: Page) => void;
}

/** The window's page history; call `record` whenever what's shown may have changed. */
export const createPages = ({ shown, live, open }: PagesInput) => {
  let history = emptyHistory;
  let opening = false;

  const record = () => {
    const page = shown();

    if (!opening && page !== undefined) history = visit(history, page);
  };

  /** Away from the current page, Back returns to it before stepping further. */
  const destination = (step: 1 | -1) => {
    const page = history.pages[history.index];

    if (step === -1 && page !== undefined && !samePage(shown(), page) && live(page)) {
      return { history, page };
    }

    return travel(history, step, live);
  };

  const go = (step: 1 | -1) => {
    const target = destination(step);

    if (target === null) return;
    history = target.history;
    // Opening a page passes through others (a Review subject, then the mode); none is a visit.
    opening = true;

    try {
      open(target.page);
    } finally {
      opening = false;
    }
  };

  const controls: BackForward = {
    back: () => go(-1),
    forward: () => go(1),
    canGoBack: () => destination(-1) !== null,
    canGoForward: () => destination(1) !== null,
  };

  return { record, ...controls };
};

/** Edit's Back and Forward (files, go to definition), set once the Editor starts. */
export interface EditPlaces {
  current: BackForward | null;
}

export const editPlaces: EditPlaces = { current: null };
