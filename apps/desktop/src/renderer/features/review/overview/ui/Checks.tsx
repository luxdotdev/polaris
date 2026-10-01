/**
 * The Checks tab: the head's checks rolled up, failing first, each with its workflow,
 * duration and a link to its run. Colour only for failing (DESIGN.md, Stacks → Colour).
 */
import { CheckIcon, CloseIcon, cn } from "@polaris/ui";
import { duration } from "../model/copy.ts";
import { checksLabel, isFailingRun, isPassingRun } from "../model/tabs.ts";
import type { CheckRunView } from "../model/types.ts";

const order = (run: CheckRunView) => {
  if (isFailingRun(run)) return 0;

  return run.status === "completed" ? 2 : 1;
};

const glyph = (run: CheckRunView) => {
  if (isFailingRun(run)) return <CloseIcon size={12} />;

  return isPassingRun(run) ? <CheckIcon size={12} /> : <span aria-hidden="true">○</span>;
};

const stateWord = (run: CheckRunView) => {
  if (run.status !== "completed") return run.status === "queued" ? "Queued" : "Running";

  return (run.conclusion ?? "done").replace("-", " ").replace(/^./, (c) => c.toUpperCase());
};

const lengthOf = (run: CheckRunView) => {
  if (run.durationMs != null) return duration(run.durationMs);

  if (run.startedAt === null || run.completedAt === null) return null;

  return duration(Date.parse(run.completedAt) - Date.parse(run.startedAt));
};

export const Checks = ({ runs }: { readonly runs: ReadonlyArray<CheckRunView> }) => {
  const sorted = [...runs].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

  return (
    <div
      className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-5 py-4"
      data-testid="checks"
    >
      <span className="text-caption text-text-subtle">
        {checksLabel(runs) ?? "No checks on this head"}
      </span>
      {sorted.length > 0 && (
        <ol className="rounded-row border-hairline bg-surface-raised flex flex-col border">
          {sorted.map((run) => (
            <li
              key={`${run.workflow ?? ""}/${run.name}`}
              data-testid="check-row"
              data-failing={isFailingRun(run) ? "" : undefined}
              className="border-hairline gap-gap h-row px-row-pad flex items-center [&+&]:border-t"
            >
              <span
                className={cn(
                  "flex w-3 justify-center",
                  isFailingRun(run) ? "text-failed-text" : "text-text-subtle"
                )}
              >
                {glyph(run)}
              </span>
              <span className="text-body text-text-default min-w-0 flex-1 truncate">
                {run.workflow === null ? run.name : `${run.workflow} / ${run.name}`}
              </span>
              <span
                className={cn(
                  "text-caption",
                  isFailingRun(run) ? "text-failed-text" : "text-text-subtle"
                )}
              >
                {stateWord(run)}
              </span>
              <span className="text-caption text-text-subtle tabular w-14 text-right">
                {lengthOf(run) ?? ""}
              </span>
              {run.url === null ? (
                <span className="w-12" />
              ) : (
                <a
                  href={run.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-caption text-text-subtle hover:text-text-default w-12 text-right"
                >
                  Open ↗
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
