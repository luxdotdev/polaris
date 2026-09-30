/**
 * Fork a session from one of its Turns, on either Harness and a chosen Model
 * (CONTEXT.md, Fork). The fork starts Dormant and opens once it exists.
 */
import type { SessionId, TurnId } from "@polaris/protocol";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type Harness,
  SegmentedControl,
} from "@polaris/ui";
import { useState } from "react";
import { newSessionId } from "../../../commands.ts";
import { send } from "../dispatch.ts";
import {
  HarnessChip,
  listedOptions,
  type ModelChoice,
  OtherHarnessesLink,
  SetupNote,
  useAvailability,
  useSignIn,
} from "../../harness/index.ts";
import { forkCommand } from "../model/intent.ts";

export interface ForkTarget {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly turnNumber: number;
  readonly harness: Harness;
  readonly model: string | null;
  readonly effort: string | null;
}

export interface ForkDialogProps {
  readonly hostKey: string;
  readonly target: ForkTarget | null;
  readonly onClose: () => void;
  readonly onForked?: ((sessionId: SessionId) => void) | undefined;
}

const ForkForm = ({
  hostKey,
  target,
  onClose,
  onForked,
}: ForkDialogProps & { readonly target: ForkTarget }) => {
  const [harness, setHarness] = useState<Harness>(target.harness);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const sameHarness = harness === target.harness;
  const { options } = useAvailability(hostKey);
  const signIn = useSignIn(hostKey);
  // Ready or needing sign-in (the rest are under "Other harnesses"); the session's own stays.
  const listed = listedOptions(options);

  const harnesses = options
    .filter((o) => listed.includes(o) || o.kind === target.harness)
    .map((o) => ({ value: o.kind, label: o.name }));

  const chosen = options.find((o) => o.kind === harness);
  const blocked = chosen !== undefined && !chosen.startable;

  const fork = () => {
    const sessionId = newSessionId();

    setBusy(true);
    void send(
      hostKey,
      forkCommand({
        sessionId,
        fromSessionId: target.sessionId,
        fromTurnId: target.turnId,
        harness,
        model: choice?.model ?? null,
        effort: choice?.effort ?? null,
      }),
      "Couldn't fork"
    ).then((ok) => {
      setBusy(false);

      if (!ok) return;
      onClose();
      onForked?.(sessionId);
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fork from turn {target.turnNumber}</DialogTitle>
        <DialogDescription>
          A new session starts from this turn's checkpoint, linked to this one.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <SegmentedControl
          aria-label="Harness"
          variant="fill"
          value={harness}
          onValueChange={(next) => {
            setHarness(next);
            setChoice(null);
          }}
          options={harnesses}
        />
        <div className="flex items-center gap-2">
          <HarnessChip
            hostKey={hostKey}
            harness={harness}
            model={choice?.model ?? (sameHarness ? target.model : null)}
            effort={choice?.effort ?? (sameHarness ? target.effort : null)}
            disabled={blocked}
            onModel={setChoice}
          />
          <span className="text-caption text-text-faint">
            {choice === null && sameHarness ? "Keeps this session's model" : null}
          </span>
        </div>
        {blocked && chosen !== undefined ? (
          <SetupNote option={chosen} onSignIn={signIn.begin} />
        ) : null}
        <OtherHarnessesLink hostKey={hostKey} options={options} />
        {signIn.dialog}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || blocked} onClick={fork}>
          Fork
        </Button>
      </DialogFooter>
    </>
  );
};

export const ForkDialog = (props: ForkDialogProps) => (
  <Dialog
    open={props.target !== null}
    onOpenChange={(open) => (open ? undefined : props.onClose())}
  >
    <DialogContent className="max-w-[420px]">
      {props.target === null ? null : <ForkForm {...props} target={props.target} />}
    </DialogContent>
  </Dialog>
);
