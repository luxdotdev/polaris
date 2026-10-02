import type { WorktreeSetupRun } from "@polaris/protocol";
import { CheckIcon, cn, PixelFailedIcon } from "@polaris/ui";
import { Match } from "effect";
import { WELL } from "./items.tsx";

export const SetupCard = ({ setup }: { readonly setup: WorktreeSetupRun }) => {
  const failed = setup.status === "failed";

  const status = Match.value(setup.status).pipe(
    Match.when("running", () => "setting up"),
    Match.when("completed", () => "done"),
    Match.when("failed", () => "failed"),
    Match.exhaustive
  );

  return (
    <details
      className={cn(WELL, "overflow-clip")}
      open={failed}
      data-testid="worktree-setup"
      data-status={setup.status}
    >
      <summary className="h-row gap-row-x px-panel flex cursor-default items-center">
        {failed ? (
          <PixelFailedIcon size={14} className="text-failed" />
        ) : setup.status === "completed" ? (
          <CheckIcon size={14} className="text-text-subtle" />
        ) : null}
        <span className="text-label text-text-default">Worktree setup</span>
        <code
          className="text-code-inline text-text-subtle min-w-0 flex-1 truncate"
          title={setup.command}
        >
          {setup.command}
        </code>
        <span className={cn("text-caption", failed ? "text-failed-text" : "text-text-subtle")}>
          {status}
        </span>
      </summary>
      <div className="px-panel pb-panel flex flex-col gap-2">
        <span className="text-caption text-text-subtle break-all">
          {setup.taskId} · {setup.cwd}
          {setup.exitCode === null ? "" : ` · exit ${setup.exitCode}`}
        </span>
        {setup.output === "" ? null : (
          <pre className="text-code-inline bg-surface-sunken rounded-row max-h-64 overflow-auto p-2">
            {setup.output}
          </pre>
        )}
        {failed ? (
          <p className="text-caption text-failed-text">
            Fix setup, then dispatch this task again. No worker slot was used.
          </p>
        ) : null}
      </div>
    </details>
  );
};
