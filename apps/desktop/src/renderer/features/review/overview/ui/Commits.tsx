/**
 * The Commits tab: the pull request's commits, oldest first, each with its checks. Picking
 * one narrows Changes to it; "All changes" widens it again.
 */
import { CheckIcon, CloseIcon, cn } from "@polaris/ui";
import { ago } from "../model/copy.ts";
import { scopeOf, setCommitScope, useCommitScope } from "../model/scope.ts";
import type { CommitView } from "../model/types.ts";
import { shortSha } from "../model/botSummary.ts";
import { Mark } from "./parts.tsx";

const ChecksMark = ({ checks }: { readonly checks: CommitView["checks"] }) => {
  if (checks === null) return <span className="w-3" />;

  if (checks.state === "failure") {
    return (
      <span className="text-failed-text" title="Checks failing">
        <CloseIcon size={12} />
      </span>
    );
  }

  return (
    <span
      className="text-text-subtle"
      title={checks.state === "pending" ? "Checks running" : "Checks passed"}
    >
      {checks.state === "pending" ? "○" : <CheckIcon size={12} />}
    </span>
  );
};

export interface CommitsProps {
  readonly subjectKey: string;
  readonly commits: ReadonlyArray<CommitView>;
  readonly mergeBase: string | null;
  readonly now: number;
  readonly onPicked: () => void;
}

export const Commits = ({ subjectKey, commits, mergeBase, now, onPicked }: CommitsProps) => {
  const scope = useCommitScope(subjectKey);

  const pick = (index: number) => {
    setCommitScope(subjectKey, scopeOf(commits, index, mergeBase));
    onPicked();
  };

  return (
    <div
      className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-5 py-4"
      data-testid="commits"
    >
      <div className="flex items-center">
        <span className="text-caption text-text-subtle flex-1">
          {commits.length === 0 ? "No commits yet" : "Pick a commit to see only its changes"}
        </span>
        {scope !== null && (
          <button
            type="button"
            onClick={() => setCommitScope(subjectKey, null)}
            className="text-caption text-text-default hover:text-text-strong cursor-default font-medium"
          >
            All changes
          </button>
        )}
      </div>
      <ol className="rounded-row border-hairline bg-surface-raised flex flex-col border">
        {commits.map((commit, index) => (
          <li key={commit.oid} className="border-hairline [&+&]:border-t">
            <button
              type="button"
              data-testid="commit-row"
              aria-current={scope?.oid === commit.oid ? "true" : undefined}
              disabled={index === 0 && mergeBase === null}
              onClick={() => pick(index)}
              className={cn(
                "gap-gap h-row px-row-x flex w-full cursor-default items-center text-left",
                scope?.oid === commit.oid ? "bg-fill-selected" : "hover:bg-fill-hover"
              )}
            >
              <ChecksMark checks={commit.checks} />
              <span className="text-code-inline text-text-subtle w-16 shrink-0 font-mono">
                {shortSha(commit.oid)}
              </span>
              <span className="text-body text-text-default min-w-0 flex-1 truncate">
                {commit.headline}
              </span>
              <Mark person={commit.author} />
              <span className="text-caption text-text-subtle w-24 shrink-0 text-right">
                {ago(commit.at, now)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};
