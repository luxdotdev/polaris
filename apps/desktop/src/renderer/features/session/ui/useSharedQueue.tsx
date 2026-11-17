/**
 * The composer in a shared session (ENG-941): a follow-up joins the Host's queue, where every
 * person's Turns wait in order, rather than this Client's own outbox; and the queue it shows.
 */
import type { AttachmentId, SessionId } from "@polaris/protocol";
import { useMemo } from "react";
import { Commands } from "../../../commands.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { usePolarisAccounts } from "../../accounts/index.ts";
import { useIsShared, useOnSharedHost } from "../../sharing/index.ts";
import { send } from "../dispatch.ts";
import { hasCapability, useHost } from "../hooks.ts";
import { type QueueViewer, queueView } from "../model/queue.ts";
import { QueuedTurns } from "./QueuedTurns.tsx";

const OWNER: QueueViewer = { kind: "owner" };

const useViewer = (teammate: boolean): QueueViewer => {
  const accounts = usePolarisAccounts();

  return useMemo(
    () =>
      teammate
        ? {
            kind: "teammate",
            names: (accounts?.accounts ?? []).flatMap((a) =>
              a.name === null ? [a.login] : [a.name, a.login]
            ),
          }
        : OWNER,
    [teammate, accounts]
  );
};

export interface SharedQueue {
  /** Sends a follow-up into the Host's queue; null when the session isn't shared. */
  readonly queue:
    | ((text: string, attachments: ReadonlyArray<{ readonly id: AttachmentId }>) => void)
    | null;
  /** The queued Turns above the draft. */
  readonly view: React.ReactNode;
}

export const useSharedQueue = (
  hostKey: string,
  sessionId: SessionId,
  model: SessionModel
): SharedQueue => {
  const teammate = useOnSharedHost(hostKey);
  const owned = useIsShared(hostKey, sessionId);
  const host = useHost(hostKey);
  const viewer = useViewer(teammate);
  const queue = queueView(model);

  const shared =
    hasCapability(host, "session.queued-turns") && (teammate || owned || queue.turns.length > 0);

  const view = (
    <QueuedTurns
      queue={queue}
      viewer={viewer}
      onCancel={(turnId) =>
        void send(hostKey, Commands.CancelQueuedTurn({ sessionId, turnId }), "Couldn't cancel")
      }
      onEdit={(turnId, prompt) =>
        void send(hostKey, Commands.EditQueuedTurn({ sessionId, turnId, prompt }), "Couldn't edit")
      }
      onResume={() =>
        void send(hostKey, Commands.ResumeQueue({ sessionId }), "Couldn't resume the queue")
      }
    />
  );

  return {
    view,
    queue: shared
      ? (text, attachments) =>
          void send(
            hostKey,
            Commands.SendTurn({
              sessionId,
              prompt: text,
              attachments: attachments.map((a) => a.id),
            }),
            "Couldn't queue"
          )
      : null,
  };
};
