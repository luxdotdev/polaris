import { AgentSession, DomainEvent } from "@polaris/protocol";

/** A settings change records no event when the next Turn would use the same settings. */
export const modelChanged = (
  session: AgentSession,
  settings: Pick<AgentSession, "model" | "effort" | "serviceTier">
): DomainEvent | null => {
  if (
    session.model === settings.model &&
    session.effort === settings.effort &&
    session.serviceTier === settings.serviceTier
  )
    return null;

  return DomainEvent.cases.SessionModelChanged.make({ sessionId: session.id, ...settings });
};
