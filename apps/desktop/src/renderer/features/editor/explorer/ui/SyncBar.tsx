/**
 * The changes tab's branch row (DESIGN.md, Editor → Sync with the remote):
 * the branch and its upstream with ↓behind ↑ahead, the one sync button, and
 * Fetch / Pull / Push in a menu. Running and failed runs show under it.
 */
import {
  Button,
  BranchIcon,
  CodeWell,
  CopyButton,
  DotsIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@polaris/ui";
import type { SyncControls } from "./useSync.ts";
import { SyncCounts, SyncGlyph } from "./SyncCounts.tsx";
import { useSeconds } from "./useSeconds.ts";

const Running = ({ controls }: { readonly controls: SyncControls }) => {
  const seconds = useSeconds(controls.startedAt);

  if (controls.view.running === null) return null;

  return (
    <div className="flex items-center gap-2" data-testid="sync-running">
      <p className="text-caption text-text-default min-w-0 flex-1 truncate">
        {controls.view.running.label}
        <span className="text-text-subtle"> · {seconds}s</span>
      </p>
      <Button variant="ghost" size="xs" onClick={controls.cancel} data-testid="sync-cancel">
        Cancel
      </Button>
    </div>
  );
};

const Failure = ({ controls }: { readonly controls: SyncControls }) => {
  const failure = controls.view.failure;

  if (failure === null) return null;
  const { next } = failure;
  const away = controls.view.away !== null;

  return (
    <div className="flex flex-col gap-1.5" data-testid="sync-failed">
      <p className="text-caption text-failed-text" data-testid="sync-failed-headline">
        {failure.headline}
      </p>
      {failure.detail === "" ? null : (
        <p className="text-caption text-text-subtle">{failure.detail}</p>
      )}
      <div className="flex items-center gap-1.5">
        {/* The bar lives in the changes tab, so "Show changes" would go nowhere. */}
        {next === null || next.kind === "changes" ? null : (
          <Button
            size="xs"
            disabled={away}
            onClick={() => controls.next(next)}
            data-testid="sync-next"
          >
            {next.label}
          </Button>
        )}
        <Button variant="ghost" size="xs" onClick={controls.dismiss}>
          Dismiss
        </Button>
        <span className="flex-1" />
        {failure.output === "" ? null : (
          <CopyButton text={failure.output} variant="icon" label="Copy git's output" />
        )}
      </div>
      {failure.output === "" ? null : (
        <CodeWell
          size="sm"
          className="bg-surface-base max-h-24 overflow-y-auto"
          data-testid="sync-output"
        >
          {failure.output.trimEnd()}
        </CodeWell>
      )}
    </div>
  );
};

const Menu = ({ controls }: { readonly controls: SyncControls }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <IconButton
        label="Fetch, pull or push"
        size="sm"
        icon={<DotsIcon size={16} />}
        className="text-text-subtle -mr-1.5"
        data-testid="sync-menu"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {controls.view.menu.map((item) => (
        <DropdownMenuItem
          key={item.action}
          disabled={!item.enabled}
          onSelect={() => controls.run(item.action)}
        >
          {item.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

/** The upstream beside the branch, or what stands in for one. */
const where = (controls: SyncControls) => {
  const { view } = controls;

  if (view.standing === "unpublished") return "· not published";

  return view.target === null ? null : `→ ${view.target}`;
};

export const SyncBar = ({ controls }: { readonly controls: SyncControls }) => {
  const { view } = controls;
  const target = where(controls);
  const idle = view.running === null;
  const away = view.away;
  // A failure's own next step stands in for the button until it's dismissed.
  const loud = view.standing !== "up-to-date" && view.primary !== null && view.failure === null;

  return (
    <div
      className="flex flex-col gap-1.5 px-4 pb-1"
      data-testid="sync-bar"
      data-standing={view.standing}
      title={away ?? undefined}
    >
      <div className="h-tree-row flex min-w-0 items-center gap-1.5">
        <BranchIcon size={14} className="text-text-subtle shrink-0" />
        <span
          className="text-label text-text-default min-w-0 shrink truncate"
          title={view.branch ?? undefined}
        >
          {view.branch ?? "Detached HEAD"}
        </span>
        <span
          className="text-caption text-text-subtle min-w-0 flex-1 truncate"
          title={target ?? undefined}
          data-testid="sync-target"
        >
          {target}
        </span>
        <SyncCounts ahead={view.ahead} behind={view.behind} />
        {view.standing === "up-to-date" && idle ? (
          <IconButton
            label={view.primary?.hint ?? "Sync"}
            size="sm"
            disabled={away !== null}
            icon={<SyncGlyph standing={view.standing} size={14} />}
            className="text-text-subtle"
            onClick={() => controls.run("sync")}
            data-testid="sync-quiet"
          />
        ) : null}
        <Menu controls={controls} />
      </div>
      {view.note === null ? null : (
        <p className="text-caption text-text-subtle" data-testid="sync-note">
          {view.note}
        </p>
      )}
      {loud && idle && view.primary !== null ? (
        <Button
          disabled={away !== null}
          title={away ?? view.primary.hint}
          onClick={() => controls.run(view.primary?.action ?? "sync")}
          className="w-full min-w-0"
          data-testid="sync-primary"
        >
          <SyncGlyph standing={view.standing} size={14} />
          <span className="truncate">{view.primary.label}</span>
        </Button>
      ) : null}
      <Running controls={controls} />
      {idle ? <Failure controls={controls} /> : null}
    </div>
  );
};
