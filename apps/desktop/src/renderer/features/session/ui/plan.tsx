/**
 * The step checklist (DESIGN.md, Turns in the conversation): done steps get a
 * check, the current one the dither and a faint Harness-hue fill and says what
 * it is doing now, pending ones a hollow dot. The plan's explanation trails it.
 */
import { CheckIcon, cn, Dither, type Harness } from "@polaris/ui";
import type { ItemView, PlanStep } from "../model/items.ts";
import { stepLabel } from "../model/meta.ts";
import { type Hue, WELL } from "./items.tsx";

const CURRENT_FILL: Record<Harness, string> = {
  claude: "bg-harness-claude-code/6",
  codex: "bg-harness-codex/6",
};

const Step = ({ step, hue }: { readonly step: PlanStep; readonly hue: Hue }) => {
  const current = step.status === "in-progress";
  const label = stepLabel(step);

  return (
    <div
      className={cn(
        "flex h-row shrink-0 items-center gap-row-x px-3",
        current && hue !== null && CURRENT_FILL[hue]
      )}
    >
      {step.status === "completed" ? <CheckIcon size={14} className="text-text-subtle" /> : null}
      {current && hue !== null ? <Dither hue={hue} size={14} moving /> : null}
      {step.status === "pending" || (current && hue === null) ? (
        <span className="flex w-3.5 justify-center">
          <span className="border-text-faint size-2 rounded-full border" />
        </span>
      ) : null}
      <span
        title={label === step.text ? undefined : step.text}
        className={cn(
          "text-body flex-1 truncate",
          step.status === "completed" && "text-text-subtle",
          current && "text-text-strong font-medium",
          step.status === "pending" && "text-text-subtle"
        )}
      >
        {label}
      </span>
    </div>
  );
};

export const Plan = ({
  item,
  hue,
}: {
  readonly item: Extract<ItemView, { kind: "plan" }>;
  readonly hue: Hue;
}) => (
  <div className={cn(WELL, "flex flex-col py-1.5")} data-testid="plan">
    {item.steps.map((step, n) => (
      <Step key={`${n}:${step.text}`} step={step} hue={hue} />
    ))}
    {item.explanation === null ? null : (
      <p
        className="text-caption text-text-subtle border-hairline mt-1.5 line-clamp-2 border-t px-3 pt-1.5"
        data-testid="plan-explanation"
      >
        {item.explanation}
      </p>
    )}
  </div>
);
