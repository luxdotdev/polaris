import { type HarnessKind, isKnownHarness, type SessionState } from "@polaris/protocol";
import { StateIcon } from "@polaris/ui";

interface SessionIconProps {
  readonly state: SessionState;
  readonly harness: HarnessKind;
}

/** The Session State glyph; a Harness this build doesn't know gets an empty slot, not a borrowed hue. */
export const SessionIcon = ({ state, harness }: SessionIconProps) =>
  isKnownHarness(harness) ? (
    <StateIcon state={state} harness={harness} />
  ) : (
    <span className="inline-block size-4" aria-hidden />
  );
