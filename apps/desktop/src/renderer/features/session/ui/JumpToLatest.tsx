/**
 * The jump-to-latest arrow, floating over the foot of the conversation while it isn't
 * following the end. New rows below mark it: the Harness's Working dither while the agent
 * works, else a quiet dot (DESIGN.md, rule/starlight-is-rare; only Working moves).
 */
import {
  ArrowDownIcon,
  cn,
  Dither,
  type Harness,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@polaris/ui";
import { commandShortcut } from "../../../../shared/keymap.ts";

export const JUMP_LABEL = "Jump to latest";

export interface JumpToLatestProps {
  readonly shown: boolean;
  /** Rows arrived below since the list stopped following. */
  readonly fresh: boolean;
  /** The agent is working; its Harness, for the dither's hue. */
  readonly working: Harness | null;
  readonly onJump: () => void;
}

const Mark = ({ fresh, working }: Pick<JumpToLatestProps, "fresh" | "working">) => {
  if (!fresh) return null;

  if (working !== null) return <Dither hue={working} size={10} moving data-testid="jump-working" />;

  return <span data-testid="jump-fresh" className="bg-text-default size-1.5 rounded-full" />;
};

export const JumpToLatest = ({ shown, fresh, working, onJump }: JumpToLatestProps) => (
  <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[7] flex justify-center">
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={JUMP_LABEL}
          data-testid="jump-to-latest"
          data-shown={shown}
          inert={!shown}
          tabIndex={shown ? 0 : -1}
          onClick={onJump}
          className={cn(
            "border-hairline bg-surface-raised text-text-subtle shadow-float hover:text-text-default flex h-7 min-w-7 cursor-default items-center justify-center gap-1.5 rounded-full border px-1.5 active:scale-[0.97]",
            shown
              ? "pointer-events-auto translate-y-0 opacity-100 transition-[opacity,transform] duration-160 ease-out motion-reduce:transition-none"
              : "translate-y-1 opacity-0"
          )}
        >
          <Mark fresh={fresh} working={working} />
          <ArrowDownIcon size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent shortcut={commandShortcut("transcript.jumpToEnd") || undefined}>
        {JUMP_LABEL}
      </TooltipContent>
    </Tooltip>
  </div>
);
