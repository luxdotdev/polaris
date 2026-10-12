/**
 * How a Turn a usage limit stopped ends (Paper 16 / 16b): neutral, since it is a wait, with
 * Continue and the per-session Resume at reset switch (off by default).
 */
import { Button, harnessHue, type Harness, PixelHourglassIcon, Switch } from "@polaris/ui";
import { useId } from "react";
import { clock } from "../../constellation/model/copy.ts";
import { usageLimitLine } from "../../../shell/copy.ts";

export interface UsageLimit {
  readonly resetsAt: string | null;
  readonly resumeAtReset: boolean;
  readonly onSetResumeAtReset: (on: boolean) => void;
}

interface LimitCardProps {
  readonly harness: Harness | null;
  readonly number: number;
  readonly limit: UsageLimit;
  readonly onContinue: () => void;
}

/** What the card says under its title, for the switch and whether the reset time is known. */
export const limitBody = (who: string, limit: Pick<UsageLimit, "resetsAt" | "resumeAtReset">) => {
  if (limit.resetsAt === null)
    return `${who} stopped at your plan's limit and didn't say when it resets. Continue picks this Turn up where it stopped.`;

  return limit.resumeAtReset
    ? `Polaris continues this Turn at ${clock(limit.resetsAt)}. You can still Continue now or start a new Turn.`
    : `${who} stopped at your plan's limit. Continue picks this Turn up where it stopped.`;
};

export const LimitCard = ({ harness, number, limit, onContinue }: LimitCardProps) => {
  const id = useId();
  const who = harness === null ? "The agent" : harnessHue(harness).name;
  const waiting = limit.resumeAtReset && limit.resetsAt === null;

  return (
    <div
      className="rounded-row border-hairline bg-surface-raised flex flex-col gap-3 border px-4 py-3.5"
      data-testid="limit-card"
    >
      <div className="flex min-w-0 items-center gap-2">
        <PixelHourglassIcon size={14} className="text-text-subtle shrink-0" />
        <span className="text-label text-text-default min-w-0 truncate">
          {usageLimitLine(limit.resetsAt)}
        </span>
        <span className="flex-1" />
        <span className="text-caption text-text-faint shrink-0">turn {number} interrupted</span>
      </div>
      <p className="text-caption text-text-subtle">{limitBody(who, limit)}</p>
      <div className="flex items-center gap-3 pt-0.5">
        <Button variant="secondary" onClick={onContinue}>
          Continue
        </Button>
        <span className="flex-1" />
        <label
          htmlFor={id}
          className="text-caption text-text-default flex items-center gap-2 data-[waiting]:opacity-(--opacity-dimmed)"
          data-waiting={waiting ? "" : undefined}
        >
          Resume at reset
          <Switch
            id={id}
            checked={limit.resumeAtReset}
            onCheckedChange={limit.onSetResumeAtReset}
          />
        </label>
      </div>
      {waiting ? (
        <p className="text-caption text-text-faint">
          Resume at reset is on: it waits until the Harness reports a reset time.
        </p>
      ) : null}
    </div>
  );
};
