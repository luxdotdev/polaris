import type { HarnessKind, SessionState } from "@polaris/protocol";
import { isHued, StateIcon } from "@polaris/ui";

interface SessionIconProps {
  readonly state: SessionState;
  readonly harness: HarnessKind;
}

/** The Session State glyph; a Harness without an identity hue gets an empty slot, not a borrowed hue. */
export const SessionIcon = ({ state, harness }: SessionIconProps) =>
  isHued(harness) ? (
    <StateIcon state={state} harness={harness} />
  ) : (
    <span className="inline-block size-4" aria-hidden />
  );
