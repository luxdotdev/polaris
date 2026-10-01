/**
 * Needs You's "Reviews" group (ENG-229): pull requests that request the user's review,
 * apart from the sessions waiting on them. A card per pull request; Review opens it.
 */
import { useShellActions } from "../../../shell/hooks.ts";
import { age } from "../../../shell/copy.ts";
import { useNow } from "../../../shell/useNow.ts";
import { openPull } from "../../../routes/review.ts";
import type { PullRowView } from "../../../../shared/github.ts";
import { usePulls } from "../store.ts";
import { PullGlyph } from "./glyphs.tsx";

const EMPTY: ReadonlyArray<PullRowView> = [];

/** The review-requested pull requests, newest first. */
export const useRequested = () => usePulls((s) => s.list?.requested ?? EMPTY);

const Card = ({ row, now }: { readonly row: PullRowView; readonly now: number }) => {
  const actions = useShellActions();
  const [owner = "", name = ""] = row.repo.split("/");

  const open = () =>
    openPull(actions, { repo: { owner, name }, number: row.number, pullId: row.id });

  const detail = [`#${row.number}`, row.repo, row.author?.login, age(row.updatedAt, now)]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <div
      data-testid="review-card"
      data-pull={row.id}
      className="rounded-card border-hairline bg-surface-raised flex items-center gap-2.5 border px-3 py-2.5"
    >
      <span className="bg-surface-sunken text-text-subtle flex size-7 shrink-0 items-center justify-center rounded-[8px]">
        <PullGlyph />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <button
          type="button"
          onClick={open}
          className="text-label text-text-strong hover:decoration-text-faint cursor-default truncate text-left hover:underline hover:underline-offset-2"
        >
          {row.title}
        </button>
        <p className="text-caption text-text-subtle truncate">{detail}</p>
      </div>
      <button
        type="button"
        onClick={open}
        className="rounded-control text-caption text-text-default hover:bg-fill-hover h-6 shrink-0 cursor-default px-1.5 font-medium"
      >
        Review
      </button>
    </div>
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
