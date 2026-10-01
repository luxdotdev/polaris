/**
 * A terminal's end, followed even while no drawer shows it: the drawer only listens to the
 * terminals it renders, and a clone or a run must still learn its exit code.
 */
import type { TerminalId } from "@polaris/protocol";
import { Predicate } from "effect";
import { polaris } from "../../bridge.ts";
import { applyStatus } from "../../terminal/store.ts";

/** Calls `onExit` once with the exit code (null: the Host no longer knows the terminal). */
export const followExit = (
  hostKey: string,
  terminalId: string,
  onExit: (code: number | null) => void
) => {
  let done = false;

  const finish = (code: number | null) => {
    if (done) return;
    done = true;
    applyStatus(terminalId, { kind: "exited", code });
    onExit(code);
  };

  const off = polaris().subscribe(
    "terminal",
    // SAFETY: terminal ids come from `terminal.open` answers.
    { hostKey, terminalId: terminalId as TerminalId },
    {
      items: (items) => {
        for (const item of items) if (!Predicate.isTagged(item, "Output")) finish(item.code);

        if (done) off();
      },
      end: (error) => {
        if (error?.code === "NotFound") finish(null);
      },
    }
  );

  return off;
};
