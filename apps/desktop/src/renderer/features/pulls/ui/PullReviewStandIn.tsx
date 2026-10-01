/**
 * The `PullReview` slot's default until the Review view lands (M2-D): which pull request
 * is open, from `github.pull.detail`, a way back to the list and the pull request on GitHub.
 */
import { Button, ChevronLeftIcon, EmptyState, PixelForkIcon } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { PullDetailView } from "../../../../shared/github.ts";
import type { PullSubject } from "../../../routes/review.ts";
import { polaris } from "../../bridge.ts";

export interface PullReviewProps {
  readonly subject: PullSubject;
  /** Back to the pull request list. */
  readonly onBack: () => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "ok"; readonly detail: PullDetailView }
  | { readonly kind: "failed"; readonly message: string };

export const PullReviewStandIn = ({ subject, onBack }: PullReviewProps) => {
  const { pull } = subject;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let live = true;

    setLoaded({ kind: "loading" });
    void polaris()
      .request("github.pull.detail", { pull: { repo: pull.repo, number: pull.number } })
      .then((result) => {
        if (!live) return;
        setLoaded(
          result.ok
            ? { kind: "ok", detail: result.value }
            : { kind: "failed", message: result.error.message }
        );
      });

    return () => {
      live = false;
    };
  }, [pull.repo, pull.number]);

  const name = `${pull.repo.owner}/${pull.repo.name} #${pull.number}`;
  const detail = loaded.kind === "ok" ? loaded.detail : null;

  return (
    <section
      data-testid="pull-review"
      data-pull={pull.pullId ?? ""}
      className="flex min-h-0 flex-1 flex-col gap-5 px-10 pt-(--spacing-tree-row)"
    >
      <button
        type="button"
        onClick={onBack}
        className="text-caption text-text-subtle hover:text-text-default flex w-fit cursor-default items-center gap-1"
      >
        <ChevronLeftIcon size={14} />
        Pull requests
      </button>
      <div className="flex flex-col gap-1">
        <h1
          className="text-display text-text-strong font-medium tracking-[-0.015em]"
          data-testid="pull-review-title"
        >
          {detail?.title ?? name}
        </h1>
        <p className="text-caption text-text-subtle">
          {detail === null
            ? name
            : `${name} · ${detail.author?.login ?? "ghost"} · ${detail.headRefName} → ${detail.baseRefName} · ${detail.files.length} files`}
        </p>
      </div>
      <EmptyState
        icon={<PixelForkIcon size={24} />}
        title={
          loaded.kind === "failed"
            ? "Couldn’t load this pull request"
            : "The diff and risk summary come next"
        }
        fact={
          loaded.kind === "failed" ? loaded.message : "Review checkouts and the diff view open here"
        }
        action={
          detail === null ? undefined : (
            <Button
              variant="secondary"
              onClick={() => void polaris().request("shell.openExternal", { url: detail.url })}
            >
              Open on GitHub
            </Button>
          )
        }
      />
    </section>
  );
};
