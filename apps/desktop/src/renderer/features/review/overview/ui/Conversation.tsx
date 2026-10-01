/**
 * The Conversation tab (Paper R9 CBX-0): the pull request's timeline with All · People ·
 * Bots, a "New since your last review" divider, and a composer whose text goes into the
 * pending review's summary (or out at once with "Comment now").
 */
import { Button, Kbd, SegmentedControl, Textarea } from "@polaris/ui";
import { useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { setSummary, summaryOf } from "../../../comments/data/store.ts";
import { commentNow } from "../data/actions.ts";
import { commentCount } from "../model/tabs.ts";
import {
  filterTimeline,
  newSinceIndex,
  peopleLine,
  type TimelineFilter,
  timelineEntries,
} from "../model/timeline.ts";
import type { PullOverviewView, TimelineItemView } from "../model/types.ts";
import { Mark } from "./parts.tsx";
import { type EntryProps, TimelineEntryView } from "./TimelineEntry.tsx";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "bots", label: "Bots" },
] as const;

/** "New since your last review", a quiet rule with its label. */
export const NewSince = () => (
  <div className="gap-gap flex items-center" data-testid="new-since-divider">
    <span className="text-caption text-text-default shrink-0 font-medium">
      New since your last review
    </span>
    <span className="bg-hairline h-px flex-1" />
  </div>
);

export const Timeline = ({
  items,
  divideAt,
  ...props
}: EntryProps & {
  readonly items: ReadonlyArray<TimelineItemView>;
  readonly divideAt: number | null;
}) => {
  const before = timelineEntries(divideAt === null ? items : items.slice(0, divideAt));
  const after = divideAt === null ? [] : timelineEntries(items.slice(divideAt));

  return (
    <div className="flex flex-col gap-2.5" data-testid="timeline">
      {before.map((entry, i) => (
        <TimelineEntryView key={i} {...props} entry={entry} />
      ))}
      {after.length > 0 && <NewSince />}
      {after.map((entry, i) => (
        <TimelineEntryView key={`n${i}`} {...props} entry={entry} />
      ))}
    </div>
  );
};

const Composer = ({
  subjectKey,
  pull,
  viewer,
  pending,
}: {
  readonly subjectKey: string;
  readonly pull: Pick<OpenPull, "repo" | "number">;
  readonly viewer: string;
  readonly pending: boolean;
}) => {
  const [text, setText] = useState("");
  const [added, setAdded] = useState(false);

  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  const sendNow = async () => {
    const body = text.trim();

    if (body === "" || state.busy) return;
    setState({ busy: true, error: null });
    const done = await commentNow(pull, body);

    setState({ busy: false, error: done.ok ? null : done.message });

    if (done.ok) setText("");
  };

  const add = () => {
    const note = text.trim();

    if (note === "") return;
    const draft = summaryOf(subjectKey).trim();

    setSummary(subjectKey, draft === "" ? note : `${draft}\n\n${note}`);
    setText("");
    setAdded(true);
  };

  return (
    <div className="flex flex-col gap-1">
      {state.error !== null && <p className="text-caption text-failed-text px-1">{state.error}</p>}
      <div
        className="rounded-row border-hairline bg-surface-raised gap-gap flex items-end border p-2 pl-3"
        data-testid="conversation-composer"
      >
        <span className="pb-1.5">
          <Mark person={{ login: viewer, bot: false }} />
        </span>
        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setAdded(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.metaKey) {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Comment on this pull request"
          rows={1}
          className="min-h-8 flex-1 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        <span className="text-caption text-text-subtle shrink-0 pb-1.5">
          {added ? "In your review" : pending ? "Adds to your review" : "Starts your review"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="text-text-default"
          disabled={text.trim() === "" || state.busy}
          onClick={() => void sendNow()}
          title="Posts it on the pull request now, outside your review"
          data-testid="conversation-comment-now"
        >
          Comment now
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={text.trim() === "" || state.busy}
          onClick={add}
          data-testid="conversation-add-to-review"
        >
          Add to review <Kbd className="border-current/25 text-current">⌘↵</Kbd>
        </Button>
      </div>
    </div>
  );
};

export interface ConversationProps extends EntryProps {
  readonly pull: Pick<OpenPull, "repo" | "number">;
  readonly overview: PullOverviewView;
  readonly viewer: string;
  readonly pending: boolean;
}

export const Conversation = ({ pull, overview, viewer, pending, ...props }: ConversationProps) => {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const items = filterTimeline(overview.timeline, filter);
  const divideAt = newSinceIndex(items, overview.viewerLastReview?.at ?? null);

  return (
    <div className="flex min-h-full flex-col" data-testid="conversation">
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 px-5 pt-4 pb-4">
        <div className="flex items-center">
          <span className="text-caption text-text-subtle flex-1">
            {peopleLine(overview.timeline, commentCount(overview.timeline))}
          </span>
          <SegmentedControl
            aria-label="Show"
            variant="well"
            options={FILTERS}
            value={filter}
            onValueChange={setFilter}
          />
        </div>
        {items.length === 0 ? (
          <p className="text-caption text-text-subtle py-6 text-center">
            {filter === "all" ? "No comments yet" : `No comments from ${filter}`}
          </p>
        ) : (
          <Timeline {...props} items={items} divideAt={divideAt} />
        )}
      </div>
      <div className="bg-bg sticky bottom-0 mx-auto w-full max-w-[720px] px-5 pb-4">
        <Composer subjectKey={props.subjectKey} pull={pull} viewer={viewer} pending={pending} />
      </div>
    </div>
  );
};
