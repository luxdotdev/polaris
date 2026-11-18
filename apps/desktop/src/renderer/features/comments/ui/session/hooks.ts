/** What every Comment surface of one Agent Session reads: its Comments, numbers and sharing. */
import type { SessionId } from "@polaris/protocol";
import { harnessHue } from "@polaris/ui";
import { useMemo } from "react";
import { useSession } from "../../../session/hooks.ts";
import { useActorViewer } from "../../../sharing/index.ts";
import {
  type ActorViewer,
  type SessionComment,
  turnNumberOf,
  wasShared,
} from "../../model/session.ts";

export interface SessionComments {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly comments: ReadonlyArray<SessionComment>;
  /** Is or was shared: Comments can be written, and Turns name their authors. */
  readonly shared: boolean;
  readonly turnNumber: (turnId: string | null | undefined) => number | null;
  /** "Claude Code", for "on Claude Code's message". */
  readonly harnessName: string | null;
  /** Who is reading: names are "You" for them and no one else. */
  readonly viewer: ActorViewer;
}

const NONE: ReadonlyArray<SessionComment> = [];

export const useSessionComments = (hostKey: string, sessionId: string): SessionComments => {
  // SAFETY: every caller passes the open session's id, from the Host.
  const model = useSession(hostKey, sessionId as SessionId);
  const comments = model.comments ?? NONE;
  const harness = model.session?.harness ?? null;
  const viewer = useActorViewer(hostKey, sessionId);

  return useMemo(
    () => ({
      hostKey,
      sessionId,
      comments,
      shared: wasShared(model.turns, comments),
      turnNumber: turnNumberOf(model.turns),
      harnessName: harness === null ? null : harnessHue(harness).name,
      viewer,
    }),
    [hostKey, sessionId, comments, model.turns, harness, viewer]
  );
};
