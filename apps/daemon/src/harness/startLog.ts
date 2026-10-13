/**
 * Info lines for opening a Harness for an Agent Session, so a start that hangs shows in the
 * Daemon log how far it got. Names, paths, versions and reasons only: never a prompt or the
 * environment.
 */
import { Effect } from "effect";

export const logStart = (sessionId: string, line: string) =>
  Effect.logInfo(`session ${sessionId}: ${line}`);
