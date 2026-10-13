/**
 * The Changes tab with `git.write` (Paper 15, 15b): the commit box, then Staged
 * and Changes. Hooks run on the Host; their output streams in under the button.
 */
import { Button, CodeWell, CopyButton, Textarea, cn } from "@polaris/ui";
import { useEffect, useMemo, useState } from "react";
import { saveFile, type TabsView } from "../../index.ts";
import type { Place } from "../data/actions.ts";
import {
  commit,
  deleteForGood,
  discard,
  setMessage,
  stage,
  unstage,
  useCommitDraft,
  type CommitDraft,
} from "../data/git.ts";
import type { GitFacts } from "../data/store.ts";
import type { AgentMarks } from "../model/agents.ts";
import { isUnder } from "../model/paths.ts";
import { allPaths, canCommit, commitLabel, type StageRow, stageLists } from "../model/stage.ts";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { rowKey, type StageSide, StageSection } from "./StageList.tsx";

export interface GitPanelProps {
  readonly place: Place;
  readonly git: GitFacts;
  readonly agents: AgentMarks;
  readonly tabs: TabsView;
  readonly hostLabel: string;
  readonly onOpen: (path: string, pin: boolean) => void;
}

const useSeconds = (since: number | null) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [since]);

  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
};

const Unsaved = ({ place, tabs }: { readonly place: Place; readonly tabs: TabsView }) => {
  const dirty = tabs.tabs.filter((tab) => tab.dirty && isUnder(tab.path, place.root));

  if (dirty.length === 0) return null;
  const what = dirty.length === 1 ? `${dirty[0]?.label} isn't` : `${dirty.length} files aren't`;

  return (
    <p
      className="text-caption text-text-subtle flex items-center gap-1"
      data-testid="commit-unsaved"
    >
      <span className="min-w-0 truncate">{what} saved ·</span>
      <button
        type="button"
        className="text-text-default hover:text-text-strong shrink-0 cursor-default"
        onClick={() => {
          for (const tab of dirty) void saveFile(place.hostKey, tab.path);
        }}
      >
        Save first
      </button>
    </p>
  );
};

const RunOutput = ({ run }: { readonly run: CommitDraft["run"] }) => {
  const seconds = useSeconds(run.kind === "running" ? run.startedAt : null);

  if (run.kind === "idle") return null;
  const running = run.kind === "running";

  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid={running ? "commit-running" : "commit-failed"}
    >
      <div className="flex items-center gap-2">
        <p
          className={cn(
            "text-caption flex-1 truncate",
            running ? "text-text-default" : "text-failed-text"
          )}
        >
          {running
            ? "Running hooks"
            : `Commit failed${run.exitCode === null ? "" : ` (exit ${run.exitCode})`}`}
          {running ? <span className="text-text-subtle"> · {seconds}s</span> : null}
        </p>
        {running || run.output === "" ? null : (
          <CopyButton
            text={run.output}
            variant="button"
            buttonVariant="ghost"
            buttonSize="xs"
            label="Copy"
          />
        )}
      </div>
      {run.output === "" ? null : (
        <CodeWell
          size="sm"
          className="bg-surface-base max-h-48 overflow-y-auto"
          data-testid="commit-output"
        >
          {run.output.trimEnd()}
        </CodeWell>
      )}
    </div>
  );
};

const CommitBox = ({
  place,
  staged,
  tabs,
}: {
  readonly place: Place;
  readonly staged: number;
  readonly tabs: TabsView;
}) => {
  const draft = useCommitDraft(place.key);
  const running = draft.run.kind === "running";
  const ready = canCommit(draft.message, staged, running);
  const go = () => (ready ? commit(place, place.root) : undefined);

  return (
    <div className="flex flex-col gap-2 px-2 pb-1" data-testid="commit-box">
      <Textarea
        aria-label="Commit message"
        placeholder="Message"
        value={draft.message}
        disabled={running}
        data-testid="commit-message"
        className="max-h-40 min-h-14"
        onChange={(event) => setMessage(place.key, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            go();
          }
        }}
      />
      <Button variant="primary" disabled={!ready} onClick={go} data-testid="commit-button">
        {running ? "Committing…" : commitLabel(staged)}
        {running ? null : <span className="text-micro opacity-60">⌘↵</span>}
      </Button>
      <Unsaved place={place} tabs={tabs} />
      <RunOutput run={draft.run} />
    </div>
  );
};

const Clean = ({
  branch,
  committed,
}: {
  readonly branch: string | null;
  readonly committed: string | null;
}) => (
  <div className="flex flex-col gap-1 px-4 py-3" data-testid="changes-empty">
    <p className="text-label text-text-default">No changes</p>
    <p className="text-caption text-text-subtle">
      {branch === null ? "The work tree" : branch} matches its last commit.
    </p>
    {committed === null ? null : (
      <p className="text-caption text-text-subtle mt-2 truncate" data-testid="last-commit">
        Committed · <span className="text-text-default">{committed}</span>
      </p>
    )}
  </div>
);

export const GitPanel = ({ place, git, agents, tabs, hostLabel, onOpen }: GitPanelProps) => {
  const lists = useMemo(
    () => stageLists(git.toplevel, place.root, git.entries, agents),
    [git.toplevel, git.entries, place.root, agents]
  );

  const draft = useCommitDraft(place.key);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [forGood, setForGood] = useState<string | null>(null);
  const locked = draft.run.kind === "running";

  if (lists.staged.length === 0 && lists.unstaged.length === 0 && draft.run.kind === "idle")
    return <Clean branch={git.branch} committed={draft.committed} />;

  const section = (side: StageSide, rows: ReadonlyArray<StageRow>) => (
    <StageSection
      place={place}
      side={side}
      rows={rows}
      active={tabs.active}
      locked={locked}
      confirming={confirming}
      onOpen={onOpen}
      onMove={(moved) =>
        void (side === "staged" ? unstage : stage)(place, place.root, allPaths(moved))
      }
      onAskDiscard={(row) => setConfirming(row === null ? null : rowKey(side, row))}
      onDiscard={(row) => {
        setConfirming(null);
        void discard(place, place.root, row, tabs).then((outcome) =>
          outcome === "confirm" ? setForGood(row.path) : undefined
        );
      }}
    />
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      data-testid="git-panel"
    >
      <CommitBox place={place} staged={lists.staged.length} tabs={tabs} />
      {section("staged", lists.staged)}
      {section("unstaged", lists.unstaged)}
      <ConfirmDelete
        path={forGood}
        host={hostLabel}
        onCancel={() => setForGood(null)}
        onConfirm={(path) => {
          setForGood(null);
          void deleteForGood(place, path, tabs);
        }}
      />
    </div>
  );
};
