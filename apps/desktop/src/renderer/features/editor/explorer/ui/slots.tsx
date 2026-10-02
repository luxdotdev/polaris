/** A tree row's two trailing slots (DESIGN.md, Editor → Explorer): agent, then git. */
import { cn, Dither, GIT_LETTERS, GIT_TINTS, type GitStatus, PixelHandIcon } from "@polaris/ui";

/** 16px: a 12px dither in the Harness hue while it changes the file, or the needs-you hand. */
export const AgentSlot = ({
  agent,
  hand,
}: {
  readonly agent: string | null;
  readonly hand: boolean;
}) => (
  <span className="flex w-4 shrink-0 justify-center" data-slot="agent">
    {hand ? (
      <PixelHandIcon
        size={12}
        className="text-needs-you"
        aria-label="Needs you"
        data-testid="tree-hand"
      />
    ) : agent !== null ? (
      <Dither
        hue={agent}
        size={12}
        moving
        aria-label="An agent is changing this file"
        data-testid="tree-dither"
      />
    ) : null}
  </span>
);

/** 14px, right-aligned: the status letter, or a 5px dot on a folder holding changes. */
export const GitSlot = ({
  git,
  dirty,
}: {
  readonly git: GitStatus | null;
  readonly dirty: boolean;
}) => (
  <span className="flex h-4 w-3.5 shrink-0 items-center justify-end" data-slot="git">
    {git !== null && git !== "ignored" ? (
      <span className={cn("text-caption", GIT_TINTS[git])} data-testid="tree-git" title={git}>
        {GIT_LETTERS[git]}
      </span>
    ) : dirty ? (
      <span className="bg-git-modified size-[5px] rounded-full" aria-label="Holds changes" />
    ) : null}
  </span>
);

/** The file name's tint: the git colour unless selected (rule/git-is-a-letter). */
export const nameTone = (git: GitStatus | null, selected: boolean, folder: boolean) => {
  if (selected) return "text-text-strong";

  if (git !== null) return GIT_TINTS[git];

  return folder ? "text-text-subtle" : "text-text-default";
};
