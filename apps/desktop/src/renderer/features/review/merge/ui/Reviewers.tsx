/**
 * The header's Reviewers control (DESIGN.md, Review → Reviewers): a quiet link with the
 * reviewers' initials, opening a popover to search people and teams, ask and stop asking,
 * and see who reviewed. Arrow keys move through the rows; ↵ asks or stops asking.
 */
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@polaris/ui";
import { useState } from "react";
import type { PullRef } from "../../../../../shared/github.ts";
import type { ReviewersView, ReviewerView } from "../../../../../shared/githubActions.ts";
import { setPanelOpen, useOpenPanel } from "../data/panels.ts";
import { changeReviewer, type SearchState, useReviewerSearch } from "../data/reviewers.ts";
import {
  canAskAgain,
  candidatesOf,
  peopleOf,
  REVIEW_STATE,
  reviewersLabel,
} from "../model/reviewers.ts";
import { Initial } from "./parts.tsx";

const FACES = 3;

const nameOf = (r: ReviewerView) => (r.kind === "team" ? `@${r.login}` : r.login);

const emptyText = (search: SearchState, canRequest: boolean) => {
  if (!canRequest) return "No one is asked yet";

  if (search.kind === "searching") return "Searching…";

  return search.kind === "failed" ? search.message : "No one else to ask";
};

const Body = ({
  pull,
  view,
  viewer,
}: {
  readonly pull: PullRef;
  readonly view: ReviewersView;
  readonly viewer: string | null;
}) => {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useReviewerSearch(pull, view.canRequest ? query : "");
  const candidates = candidatesOf(view, search.kind === "ok" ? search.results : null);
  const searching = query.trim() !== "";

  const change = async (reviewer: ReviewerView, add: boolean) => {
    if (busy || !view.canRequest) return;
    setBusy(true);
    setError(await changeReviewer(pull, reviewer, add));
    setBusy(false);
  };

  return (
    <Command shouldFilter={false} loop data-testid="reviewers-panel">
      {view.canRequest && (
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search people and teams"
          className="text-body"
        />
      )}
      <CommandList className="max-h-[320px]">
        <CommandEmpty>{emptyText(search, view.canRequest)}</CommandEmpty>
        {!searching && view.requested.length > 0 && (
          <CommandGroup heading="Asked">
            {view.requested.map((r) => (
              <CommandItem
                key={`asked:${r.kind}:${r.login}`}
                value={`asked:${r.kind}:${r.login}`}
                data-testid="reviewer-asked"
                leading={<Initial name={r.login} size={16} />}
                detail={r.name ?? undefined}
                meta={view.canRequest ? "Stop asking" : "waiting"}
                onSelect={() => void change(r, false)}
              >
                {nameOf(r)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!searching && view.reviewed.length > 0 && (
          <CommandGroup heading="Reviewed">
            {view.reviewed.map((r) => (
              <CommandItem
                key={`reviewed:${r.login}`}
                value={`reviewed:${r.login}`}
                data-testid="reviewer-reviewed"
                data-review={r.state}
                leading={<Initial name={r.login} size={16} />}
                meta={
                  view.canRequest && canAskAgain(view, r.login, viewer)
                    ? `${REVIEW_STATE[r.state]} · Ask again`
                    : REVIEW_STATE[r.state]
                }
                onSelect={() => {
                  if (canAskAgain(view, r.login, viewer))
                    void change({ kind: "user", login: r.login, name: null }, true);
                }}
              >
                {r.login}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {view.canRequest && candidates.length > 0 && (
          <CommandGroup heading={searching ? "Matches" : "Suggested"}>
            {candidates.map((r) => (
              <CommandItem
                key={`ask:${r.kind}:${r.login}`}
                value={`ask:${r.kind}:${r.login}`}
                data-testid="reviewer-candidate"
                leading={<Initial name={r.login} size={16} />}
                detail={r.name ?? undefined}
                meta="Ask"
                onSelect={() => void change(r, true)}
              >
                {nameOf(r)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      {error !== null && (
        <p role="alert" className="text-caption text-failed-text px-3.5 pb-2.5">
          {error}
        </p>
      )}
      {!view.canRequest && (
        <p className="text-caption text-text-subtle border-hairline border-t px-3.5 py-2.5">
          You can see who's asked, but asking needs triage access to the repository.
        </p>
      )}
    </Command>
  );
};

export interface ReviewersProps {
  readonly pull: PullRef;
  readonly view: ReviewersView | null;
  /** The account that asks, which can't ask itself. */
  readonly viewer: string | null;
}

export const Reviewers = ({ pull, view, viewer }: ReviewersProps) => {
  const open = useOpenPanel() === "reviewers";

  if (view === null) return null;
  const people = peopleOf(view);

  return (
    <Popover open={open} onOpenChange={(next) => setPanelOpen("reviewers", next)}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="reviewers-open" className="font-normal">
          {people.length > 0 && (
            <span className="flex -space-x-1">
              {people.slice(0, FACES).map((login) => (
                <Initial key={login} name={login} size={18} />
              ))}
            </span>
          )}
          {reviewersLabel(view)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] overflow-clip p-0">
        <Body pull={pull} view={view} viewer={viewer} />
      </PopoverContent>
    </Popover>
  );
};
