/**
 * "Send review comments": the linked pull request's unresolved threads, as the session's
 * next Turn (`SendFeedback`). What was sent is remembered on this Mac per session, so a
 * thread goes again only once someone adds to it.
 */
import type { SessionId } from "@polaris/protocol";
import { Option, Schema } from "effect";
import type { PullRef } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import { polaris } from "../../bridge.ts";
import { send } from "../../session/dispatch.ts";
import { pullFeedback, type SentComments, unsentThreads } from "../model/pullComments.ts";

const KEY = (hostKey: string, sessionId: string) =>
  `polaris.accept.sent.v1.${hostKey}.${sessionId}`;

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
);

const load = (hostKey: string, sessionId: string): SentComments => {
  try {
    return Option.getOrElse(
      decode(localStorage.getItem(KEY(hostKey, sessionId)) ?? "{}"),
      () => ({})
    );
  } catch {
    return {};
  }
};

const save = (hostKey: string, sessionId: string, sent: SentComments) => {
  try {
    localStorage.setItem(KEY(hostKey, sessionId), JSON.stringify(sent));
  } catch {
    // Storage blocked: the threads may be offered again; sending twice is harmless.
  }
};

/** How many threads would go now; null when the pull request can't be read. */
export const unsentCount = async (hostKey: string, sessionId: string, pull: PullRef) => {
  const detail = await polaris().request("github.pull.detail", { pull });

  return detail.ok ? unsentThreads(detail.value, load(hostKey, sessionId)).length : null;
};

/** Sends the unsent threads as one Turn; answers how many went. */
export const sendPullComments = async (hostKey: string, sessionId: SessionId, pull: PullRef) => {
  const detail = await polaris().request("github.pull.detail", { pull });

  if (!detail.ok) return 0;
  const feedback = pullFeedback(detail.value, load(hostKey, sessionId));

  if (feedback === null) return 0;

  const ok = await send(
    hostKey,
    Commands.SendFeedback({ sessionId, feedback: feedback.batch, attachments: [] }),
    "Couldn't send the review comments"
  );

  if (!ok) return 0;
  save(hostKey, sessionId, feedback.sent);

  return feedback.batch.comments.length;
};
