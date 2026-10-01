/**
 * A pull request's comments that have no line in the diff (ENG-223), in the risk column:
 * outdated drafts, kept and anchored to the commit they were written on (with the hunk
 * they quoted), which can be moved to the selected lines or discarded; outdated published
 * threads, folded as on GitHub; and comments on whole files.
 */
import { Button } from "@polaris/ui";
import { useStore } from "zustand";
import type { ReviewThreadView } from "../../../../shared/github.ts";
import { emptySurface, surfaceStore } from "../../review/index.ts";
import { openComposer, useComments } from "../data/store.ts";
import { isDraft, placeLabel, placeThreads } from "../model/threads.ts";
import { ThreadCard } from "./ThreadCard.tsx";

const MoveHere = ({
  subjectKey,
  thread,
}: {
  readonly subjectKey: string;
  readonly thread: ReviewThreadView;
}) => {
  const selection = useStore(surfaceStore, (s) => (s[subjectKey] ?? emptySurface).selection);
  const draft = thread.comments.find((c) => c.pending);

  if (draft === undefined) return null;

  return (
    <Button
      size="xs"
      variant="secondary"
      disabled={selection === null}
      title={selection === null ? "Select lines in the diff first" : undefined}
      onClick={() => {
        if (selection !== null)
          openComposer(subjectKey, selection, { text: draft.body, moving: draft.id });
      }}
    >
      Move to selection
    </Button>
  );
};

const Listed = ({
  subjectKey,
  thread,
}: {
  readonly subjectKey: string;
  readonly thread: ReviewThreadView;
}) => (
  <div className="flex flex-col gap-1">
    <div className="gap-gap flex items-center">
      <span className="text-text-subtle font-mono text-[11px] leading-4">{placeLabel(thread)}</span>
    </div>
    {thread.anchor.kind === "outdated" && isDraft(thread) && thread.anchor.diffHunk !== "" && (
      <pre className="bg-surface-sunken border-hairline rounded-control text-text-subtle max-h-24 overflow-hidden border px-2 py-1 font-mono text-[11px] leading-4">
        {thread.anchor.diffHunk.split("\n").slice(-4).join("\n")}
      </pre>
    )}
    <ThreadCard
      subjectKey={subjectKey}
      threadId={thread.id}
      variant="list"
      extra={
        isDraft(thread) && thread.anchor.kind === "outdated" ? (
          <MoveHere subjectKey={subjectKey} thread={thread} />
        ) : undefined
      }
    />
  </div>
);

const Group = ({
  title,
  subjectKey,
  threads,
}: {
  readonly title: string;
  readonly subjectKey: string;
  readonly threads: ReadonlyArray<ReviewThreadView>;
}) =>
  threads.length === 0 ? null : (
    <section className="flex flex-col gap-2" data-testid="comments-group" data-group={title}>
      <h3 className="text-caption text-text-faint">
        {title} · {threads.length}
      </h3>
      {threads.map((thread) => (
        <Listed key={thread.id} subjectKey={subjectKey} thread={thread} />
      ))}
    </section>
  );

export const CommentsSection = ({ subjectKey }: { readonly subjectKey: string }) => {
  const threads = useComments((s) => s.pulls[subjectKey]?.detail?.threads);

  if (threads === undefined) return null;
  const places = placeThreads(threads);

  if (places.outdated.length === 0 && places.files.length === 0) return null;

  return (
    <div className="px-panel flex flex-col gap-3 pt-3" data-testid="comments-section">
      <Group
        title="Outdated drafts"
        subjectKey={subjectKey}
        threads={places.outdated.filter(isDraft)}
      />
      <Group title="On whole files" subjectKey={subjectKey} threads={places.files} />
      <Group
        title="Outdated"
        subjectKey={subjectKey}
        threads={places.outdated.filter((t) => !isDraft(t))}
      />
    </div>
  );
};
