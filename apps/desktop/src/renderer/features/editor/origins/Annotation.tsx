/**
 * The inline annotation at the end of the cursor's line (DESIGN.md, Origins): the author and
 * time, then the session that wrote it by title, or how many did, as Hosts answer.
 */
import type { BlameCommit } from "@polaris/protocol";
import { Celestial, sessionCelestial } from "@polaris/ui";
import { useSyncExternalStore } from "react";
import type { Lookup } from "./data.ts";
import { annotationLead, mergeLine, sessionsText } from "./model.ts";

export interface AnnotationProps {
  readonly line: number;
  readonly commit: BlameCommit | null;
  readonly lookup: Lookup | null;
  readonly now: number;
}

const NO_HOSTS = { hosts: () => [], subscribe: () => () => undefined } satisfies Lookup;

export const Annotation = ({ line, commit, lookup, now }: AnnotationProps) => {
  const source = lookup ?? NO_HOSTS;
  const hosts = useSyncExternalStore(source.subscribe, source.hosts);
  const { sessions } = mergeLine(line, hosts);
  const text = sessionsText(sessions);

  return (
    <>
      <span className="cm-originLead">{annotationLead(commit, now)}</span>
      {text === null ? null : (
        <>
          <span className="cm-originDot">·</span>
          <span className="cm-originBodies">
            {sessions.slice(0, 2).map(({ hostKey, session }) => (
              <Celestial
                key={`${hostKey}:${session.sessionId}`}
                body={sessionCelestial(session.celestial)}
                harness={session.harness}
                size={16}
                className={session.archived ? "opacity-45" : undefined}
              />
            ))}
          </span>
          <span className={sessions.length === 1 ? "cm-originTitle" : undefined}>{text}</span>
        </>
      )}
    </>
  );
};
