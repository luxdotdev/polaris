/**
 * The model picker's wells (DESIGN.md, Menus and popovers; Paper X-F 01): the Models, then
 * effort as a full-width track, fast mode and the Plan Limits.
 */
import type { HarnessKind } from "@polaris/protocol";
import { CheckIcon, ChevronRightIcon, cn, EffortTrack, harnessHue, KICKER } from "@polaris/ui";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { useNow } from "../../../shell/useNow.ts";
import { useHarnessRunning, usePlanLimits } from "../live.ts";
import {
  freshness,
  leftCells,
  leftPhrase,
  type LimitData,
  limitsFor,
  shortDuration,
  windowName,
} from "../model/limits.ts";
import { effortFor, effortNote, type ModelData } from "../model/models.ts";

const ROW =
  "rounded-control flex h-8 w-full shrink-0 cursor-default items-center gap-2 px-2.5 text-left text-body outline-none hover:bg-fill-hover focus-visible:bg-fill-hover focus-visible:outline-starlight focus-visible:outline-2";

const DASHED = "border-hairline border-t border-dashed";

/** ↑/↓ move between the well's rows, as in a menu. */
const roveRows = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-row]")];
  const at = rows.findIndex((row) => row === document.activeElement);
  const next = rows[event.key === "ArrowDown" ? at + 1 : at - 1];

  if (next === undefined) return;
  event.preventDefault();
  next.focus();
};

const ModelRow = ({
  model,
  checked,
  onPick,
}: {
  readonly model: ModelData;
  readonly checked: boolean;
  readonly onPick: () => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={checked}
    data-row=""
    data-selected={checked ? "" : undefined}
    className={cn(ROW, checked ? "bg-fill-selected text-text-strong" : "text-text-default")}
    onClick={onPick}
    data-testid="model-option"
  >
    <span className="min-w-0 flex-1 truncate" title={model.name}>
      {model.name}
    </span>
    {model.isDefault ? <span className={KICKER}>default</span> : null}
    <span className="flex w-4 shrink-0 justify-center">
      {checked ? <CheckIcon size={14} /> : null}
    </span>
  </button>
);

export interface ModelsWellProps {
  readonly top: ReadonlyArray<ModelData>;
  readonly more: ReadonlyArray<ModelData>;
  readonly shown: string | null;
  readonly note?: string | undefined;
  readonly blocked?: string | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onPick: (model: ModelData) => void;
  readonly onRefresh: () => void;
  readonly onOtherHarnesses: () => void;
}

const Line = ({ children }: { readonly children: ReactNode }) => (
  <p className="text-caption text-text-subtle px-2.5 py-1.5">{children}</p>
);

/** The Models: the newest four, the rest behind "More models", then refresh and setup. */
export const ModelsWell = (props: ModelsWellProps) => {
  const { top, more, shown, onPick } = props;
  // A pick from the longer list keeps it open.
  const [expanded, setExpanded] = useState(() => more.some((m) => m.id === shown));

  return (
    <div className="flex flex-col p-1" onKeyDown={roveRows}>
      {props.note === undefined ? null : <Line>{props.note}</Line>}
      {props.blocked === undefined ? null : <Line>{props.blocked}</Line>}
      {props.loading ? <Line>Loading…</Line> : null}
      {props.error === null ? null : <Line>{props.error}</Line>}
      {props.blocked === undefined ? (
        <div role="radiogroup" aria-label="Model" className="flex flex-col gap-px">
          {top.map((m) => (
            <ModelRow key={m.id} model={m} checked={m.id === shown} onPick={() => onPick(m)} />
          ))}
          {more.length === 0 ? null : (
            <button
              type="button"
              data-row=""
              aria-expanded={expanded}
              className={cn(ROW, "text-text-subtle")}
              onClick={() => setExpanded((open) => !open)}
              data-testid="more-models"
            >
              <span className="flex-1">More models</span>
              <ChevronRightIcon
                size={14}
                className={cn("transition-transform duration-120", expanded && "rotate-90")}
              />
            </button>
          )}
          {expanded
            ? more.map((m) => (
                <ModelRow key={m.id} model={m} checked={m.id === shown} onPick={() => onPick(m)} />
              ))
            : null}
        </div>
      ) : null}
      <div className={cn(DASHED, "mt-1 flex pt-1")}>
        <button
          type="button"
          data-row=""
          className={cn(ROW, "text-caption text-text-subtle flex-1")}
          onClick={props.onRefresh}
          data-testid="refresh-models"
        >
          Refresh models
        </button>
        <button
          type="button"
          data-row=""
          className={cn(ROW, "text-caption text-text-subtle w-auto")}
          onClick={props.onOtherHarnesses}
          data-testid="other-harnesses"
        >
          Other harnesses…
        </button>
      </div>
    </div>
  );
};

const capital = (level: string) => level.charAt(0).toUpperCase() + level.slice(1);

const EffortSection = ({
  harness,
  model,
  effort,
  onStage,
  onSend,
}: {
  readonly harness: HarnessKind;
  readonly model: ModelData;
  readonly effort: string | null;
  readonly onStage: (effort: string) => void;
  readonly onSend: () => void;
}) => {
  const level = effortFor(model, effort);
  const index = Math.max(0, model.efforts.indexOf(level ?? ""));
  const note = effortNote(harnessHue(harness).name, model);

  return (
    <div className="flex flex-col gap-2 px-3.5 pt-3 pb-3" data-testid="effort-bar">
      <div className="flex items-baseline">
        <span className="text-body text-text-default flex-1">Effort</span>
        <span className="text-caption text-text-subtle" data-testid="effort-level">
          {level === null ? null : capital(level)}
        </span>
      </div>
      <EffortTrack
        levels={model.efforts}
        value={index}
        hue={harness}
        onChange={(i) => onStage(model.efforts[i] ?? "")}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onSend();
        }}
      />
      {note === null ? null : <p className="text-caption text-text-subtle">{note}</p>}
    </div>
  );
};

const FastIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z" />
  </svg>
);

export { FastIcon };

const FastRow = ({
  harness,
  available,
  on,
  onToggle,
}: {
  readonly harness: HarnessKind;
  readonly available: boolean;
  readonly on: boolean;
  readonly onToggle: (on: boolean) => void;
}) => {
  if (harness === "codex" && !available) return null;
  const offered = harness === "codex";

  return (
    <label
      className={cn(
        DASHED,
        "flex items-center gap-2.5 px-3.5 py-2.5",
        offered ? "text-text-default" : "text-text-faint"
      )}
    >
      <input
        type="checkbox"
        className="accent-text-strong size-3.5"
        checked={offered && on}
        disabled={!offered}
        onChange={(event) => onToggle(event.currentTarget.checked)}
        data-testid="fast-mode-toggle"
      />
      <FastIcon />
      <span className="text-body flex-1">Fast mode</span>
      <span className="text-caption text-text-subtle">
        {offered ? "Faster, higher usage cost" : "Codex only"}
      </span>
    </label>
  );
};

const TICKS = 48;

/** A window's share left as ticks, each fifth taller, the edge marked: full ones are what's left. */
const LimitMeter = ({ usedPercent }: { readonly usedPercent: number }) => {
  const full = leftCells(usedPercent, TICKS);

  return (
    <svg
      width={TICKS * 6}
      height={14}
      viewBox={`0 0 ${TICKS * 6} 14`}
      aria-hidden
      className="block max-w-full [shape-rendering:crispEdges]"
    >
      {Array.from({ length: TICKS }, (_, i) => (
        <rect
          // Ticks are positional.
          key={i}
          x={i * 6}
          y={i % 5 === 0 ? 2 : 6}
          width={2}
          height={i % 5 === 0 ? 12 : 8}
          className={i < full ? "fill-text-default" : "fill-text-faint opacity-40"}
        />
      ))}
      {full > 0 && full < TICKS ? (
        <rect x={full * 6 - 3} y={0} width={2} height={14} className="fill-text-strong" />
      ) : null}
    </svg>
  );
};

const LimitRow = ({ limit, now }: { readonly limit: LimitData; readonly now: number }) => {
  const reset =
    limit.resetsAt === null ? null : `resets in ${shortDuration(Date.parse(limit.resetsAt) - now)}`;

  const value =
    limit.status === "reached"
      ? "limit reached"
      : [
          limit.status === "warning" ? "nearly reached" : null,
          limit.usedPercent === null ? null : leftPhrase(limit.usedPercent),
        ]
          .filter((p) => p !== null)
          .join(" · ");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-body text-text-default">{windowName(limit)}</span>
        <span className="text-body text-text-strong tabular flex-1 font-medium">{value}</span>
        {reset === null ? null : (
          <span className="text-text-subtle font-mono text-[11px] leading-[14px]">{reset}</span>
        )}
      </div>
      {limit.usedPercent === null ? null : <LimitMeter usedPercent={limit.usedPercent} />}
    </div>
  );
};

const Limits = ({
  hostKey,
  harness,
}: {
  readonly hostKey: string;
  readonly harness: HarnessKind;
}) => {
  const limits = limitsFor(usePlanLimits(hostKey), harness);
  const now = useNow(60_000);
  const running = useHarnessRunning(hostKey, harness);

  if (limits.length === 0) return null;
  const fresh = freshness(limits, now, running);

  return (
    <div className={cn(DASHED, "flex flex-col gap-3 px-3.5 pt-3 pb-3.5")} data-testid="plan-limits">
      {limits.map((l) => (
        <LimitRow key={`${l.kind}:${l.scope ?? ""}`} limit={l} now={now} />
      ))}
      {fresh === null ? null : <span className={KICKER}>{fresh}</span>}
    </div>
  );
};

export interface SettingsWellProps {
  readonly hostKey: string;
  readonly harness: HarnessKind;
  readonly model: ModelData | undefined;
  readonly effort: string | null;
  readonly fastAvailable: boolean;
  readonly fast: boolean;
  readonly onEffort: (effort: string) => void;
  readonly onFast: (on: boolean) => void;
  readonly onSend: () => void;
}

/** Effort, fast mode and the Plan Limits; what isn't there for this Harness is left out. */
export const SettingsWell = (props: SettingsWellProps) => {
  const { model } = props;
  const effort = model !== undefined && model.efforts.length > 0;

  return (
    <div className="flex flex-col [&>:first-child]:border-t-0">
      {effort ? (
        <EffortSection
          harness={props.harness}
          model={model}
          effort={props.effort}
          onStage={props.onEffort}
          onSend={props.onSend}
        />
      ) : null}
      <FastRow
        harness={props.harness}
        available={props.fastAvailable}
        on={props.fast}
        onToggle={props.onFast}
      />
      <Limits hostKey={props.hostKey} harness={props.harness} />
    </div>
  );
};
