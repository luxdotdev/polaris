/** The inbox as the main process needs it: the count, and who is waiting on what. */
import { harnessHue } from "@polaris/ui";
import type { NeedsYouSession, NeedsYouSummary } from "../../../../shared/needsYou.ts";
import type { Inbox } from "./inbox.ts";

export interface SummaryInput {
  readonly inbox: Inbox;
  /** The session the window shows, if any. */
  readonly focused: { readonly hostKey: string; readonly sessionId: string } | null;
}

export const toSummary = ({ inbox, focused }: SummaryInput): NeedsYouSummary => {
  const waiting = inbox.waiting.map((w): NeedsYouSession => ({
    hostKey: w.hostKey,
    hostLabel: w.hostLabel,
    workspace: w.workspace,
    sessionId: w.entry.session.id,
    title: w.entry.session.title,
    harness: harnessHue(w.entry.session.harness).name,
    requests: w.requests.map((r) => ({
      requestId: r.id,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      options: r.options,
    })),
  }));

  const interrupted = inbox.also
    .filter((a) => a.kind === "interrupted")
    .map((a): NeedsYouSession => ({
      hostKey: a.hostKey,
      hostLabel: a.hostLabel,
      workspace: a.workspace,
      sessionId: a.entry.session.id,
      title: a.entry.session.title,
      harness: harnessHue(a.entry.session.harness).name,
      requests: [],
    }));

  return { count: inbox.count, sessions: [...waiting, ...interrupted], focused };
};
