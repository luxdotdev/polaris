/**
 * The sign-in hand-off (ADR 0001): a Harness's own sign-in runs in a Polaris
 * terminal on the Host (the terminal feature's `HarnessTerminal`); Polaris
 * never sees a key. When it exits, availability is probed again, so a
 * signed-in Harness turns ready by itself.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@polaris/ui";
import { HarnessTerminal } from "../../terminal/index.ts";
import { refreshAvailability } from "../live.ts";

export interface SignInTarget {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly harnessName: string;
  readonly argv: ReadonlyArray<string>;
}

export const SignInTerminal = ({
  target,
  onClose,
}: {
  readonly target: SignInTarget | null;
  readonly onClose: () => void;
}) => (
  <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
    <DialogContent className="w-[640px]" data-testid="sign-in">
      {target === null ? null : (
        <>
          <DialogHeader>
            <DialogTitle>
              Sign in to {target.harnessName} on {target.hostLabel}
            </DialogTitle>
            <DialogDescription>
              {target.harnessName}'s own sign-in runs here, in a terminal on the host. Polaris never
              sees your credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-5">
            <HarnessTerminal
              hostKey={target.hostKey}
              argv={target.argv}
              onExit={() => void refreshAvailability(target.hostKey)}
              onClose={onClose}
            />
          </div>
        </>
      )}
    </DialogContent>
  </Dialog>
);
