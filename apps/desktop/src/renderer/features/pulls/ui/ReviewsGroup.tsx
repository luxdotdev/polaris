/**
 * Needs You's "Reviews" group (ENG-229): pull requests that request the user's review,
 * apart from the sessions waiting on them. A card per pull request; a click opens it in Review.
 */
import { useShellActions } from "../../../shell/hooks.ts";
import { age } from "../../../shell/copy.ts";
import { useNow } from "../../../shell/useNow.ts";
import { openPull } from "../../../routes/review.ts";
import { type PullRowView, repoOfRow } from "../../../../shared/github.ts";
import { usePulls } from "../store.ts";
import { PullGlyph } from "./glyphs.tsx";

const EMPTY: ReadonlyArray<PullRowView> = [];

/** The review-requested pull requests, newest first. */
export const useRequested = () => usePulls((s) => s.list?.requested ?? EMPTY);

const Card = ({ row, now }: { readonly row: PullRowView; readonly now: number }) => {
  const actions = useShellActions();
  const repo = repoOfRow(row);
  const { name } = repo;

  const open = () => openPull(actions, { repo, number: row.number, pullId: row.id });

  const detail = [`#${row.number}`, name, row.author?.login]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <button
      type="button"
      data-testid="review-card"
      data-pull={row.id}
      onClick={open}
      aria-label={`Review ${row.title}, ${row.repo} #${row.number}`}
      className="rounded-card border-hairline bg-surface-raised hover:bg-fill-hover flex w-full cursor-default items-start gap-2.5 border px-3 py-2.5 text-left"
    >
      <span className="bg-surface-sunken text-text-subtle flex size-7 shrink-0 items-center justify-center rounded-[8px]">
        <PullGlyph />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-label text-text-strong line-clamp-2">{row.title}</span>
        <span className="text-caption text-text-subtle flex min-w-0 gap-1">
          <span className="truncate">{detail}</span>
          {/* The age stays when a long repo name truncates. */}
          <span className="tabular shrink-0">· {age(row.updatedAt, now)}</span>
        </span>
      </span>
    </button>
  );
};

export const ReviewsGroup = () => {
  const requested = useRequested();
  const now = useNow(30_000);

  if (requested.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="needs-you-reviews" aria-label="Reviews">
      <p className="text-caption text-text-subtle px-1.5 pt-2.5 pb-0.5">Reviews</p>
      {requested.map((row) => (
        <Card key={row.id} row={row} now={now} />
      ))}
    </section>
  );
};
