/**
 * The header's Merge button and its popover. Hidden when the account can't merge or the pull
 * request isn't open; "Merge blocked · 4 checks failing" says why when GitHub won't; primary
 * when the viewer is done with it (their own, or approved by them), else secondary.
 */
import { Button, Popover, PopoverContent, PopoverTrigger } from "@polaris/ui";
import type { OpenPull } from "../../../../../shared/api.ts";
import type { PullActionsView } from "../../../../../shared/githubActions.ts";
import type { Held } from "../../checkout/actions.ts";
import { setPanelOpen, useOpenPanel } from "../data/panels.ts";
import { BUTTON_LABEL, mergeButton, mergeLeads } from "../model/merge.ts";
import type { LinkedSession } from "../model/local.ts";
import { MergePanel } from "./MergePanel.tsx";

export interface MergeActionProps {
  readonly pull: OpenPull;
  readonly actions: PullActionsView | null;
  readonly commits: number;
  readonly checkout: Held | null;
  readonly session: LinkedSession | null;
}

export const MergeAction = ({ pull, actions, commits, checkout, session }: MergeActionProps) => {
  const open = useOpenPanel() === "merge";
  const view = actions?.merge ?? null;
  const button = mergeButton(view);

  if (view === null || actions === null || button.kind === "hidden") return null;
  const leads = mergeLeads(view, actions.reviewers);

  return (
    <Popover open={open} onOpenChange={(next) => setPanelOpen("merge", next)}>
      <PopoverTrigger asChild>
        <Button
          variant={leads ? "primary" : "secondary"}
          data-testid="merge-open"
          data-state={button.kind}
        >
          {BUTTON_LABEL[button.kind]}
          {button.kind === "blocked" && (
            <span className="text-text-subtle font-normal">· {button.reason}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] overflow-clip p-0">
        <MergePanel
          pull={pull}
          view={view}
          button={button}
          commits={commits}
          checkout={checkout}
          session={session}
          onDone={() => setPanelOpen("merge", false)}
        />
      </PopoverContent>
    </Popover>
  );
};
