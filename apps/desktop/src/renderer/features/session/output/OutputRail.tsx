/**
 * Output collapsed (DESIGN.md, Output): a 240px rail of facts about the
 * session's Workspace, so the conversation gets the room. The session's
 * first edit in a Turn opens the panel; so do the chevron, the changes row
 * and ⌘⌥B.
 */
import { BranchIcon, ChevronLeftIcon, cn, FolderIcon, IconButton, ServerIcon } from "@polaris/ui";
import type { TurnId } from "@polaris/protocol";
import { Predicate } from "effect";
import { type ReactNode, useEffect, useRef } from "react";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { homePath, plural, sessionStateLabel } from "../../../shell/copy.ts";
import { SessionGlyph } from "../../../shell/glyphs.tsx";
import { useHost, useSession } from "../hooks.ts";
import { uiKey } from "../state.ts";
import { openForEdit, setOutputOpen } from "./open.ts";
import { diffRevision, useTurnDiff } from "../turnDiff.ts";
import type { SessionViewProps } from "../ui/SessionIntent.tsx";
import { type GitFacts, useGitFacts } from "./gitStatus.ts";
import { RAIL_WIDTH } from "./layout.ts";
import { useSettings } from "../../settings/index.ts";
import { useFilesTick } from "./watch.ts";

/** The toaster's right inset (polish): toasts clear the rail while it shows. */
const useToastInset = () =>
  useEffect(() => {
    const root = document.documentElement.style;

    root.setProperty("--toast-inset-right", `${RAIL_WIDTH + 16}px`);

    return () => {
      root.removeProperty("--toast-inset-right");
    };
  }, []);

/**
 * The latest Turn if it runs while the rail shows: working when the rail
 * mounted, or started since. A Turn already over when you arrive opens nothing.
 */
const useLiveTurn = (model: SessionModel): TurnId | null => {
  const baseline = useRef<TurnId | null | undefined>(undefined);
  const latest = model.turns.at(-1) ?? null;

  if (baseline.current === undefined && model.synchronized) {
    baseline.current = latest === null || latest.turn.status === "working" ? null : latest.turn.id;
  }

  if (baseline.current === undefined || latest === null) return null;

  return latest.turn.id === baseline.current ? null : latest.turn.id;
};

const Fact = ({
  icon,
  children,
  title,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly title?: string;
}) => (
  <div className="h-row px-row-x gap-row-x flex min-w-0 items-center" title={title}>
    <span className="text-text-subtle grid size-4 shrink-0 place-items-center">{icon}</span>
    {children}
  </div>
);

export const SHOW_HINT = "⌘⌥B";

const branchText = (git: GitFacts) => {
  if (git.kind === "ready") return git.branch ?? "detached HEAD";

  return git.kind === "none" ? "Not a git repository" : "";
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const changesText = (git: GitFacts) => {
  if (git.kind !== "ready") return "";

  // git status folds a new directory into one entry, so these are changes, not files.
  return git.changed === 0 ? "No changes" : plural(git.changed, "change");
};

export const OutputRail = ({ hostKey, sessionId }: SessionViewProps) => {
  const model = useSession(hostKey, sessionId);
  const host = useHost(hostKey);
  const key = uiKey(hostKey, sessionId);
  const cwd = model.session?.cwd ?? null;
  const tick = useFilesTick(hostKey, cwd);
  const git = useGitFacts(hostKey, cwd, tick);
  const latest = model.turns.at(-1) ?? null;
  const turnId = useLiveTurn(model);
  const edits = latest?.items.some((i) => Predicate.isTagged(i, "FileChange")) ?? false;

  // Harnesses that edit through commands leave no FileChange: the Turn's diff tells.
  const diff = useTurnDiff(
    hostKey,
    cwd ?? "",
    sessionId,
    edits ? null : turnId,
    latest === null ? "" : diffRevision(latest, tick)
  );

  const edited = edits || (diff.kind === "ready" && diff.files.length > 0);

  useToastInset();
  const autoOpen = useSettings((s) => s.sessions.openOutputOnEdit);

  useEffect(() => {
    if (autoOpen && edited && turnId !== null) openForEdit(key);
  }, [autoOpen, edited, key, turnId]);

  const open = () => setOutputOpen(key, true);
  const session = model.session;

  return (
    <section aria-label="Output" className="flex min-h-0 flex-1 flex-col" data-testid="output-rail">
      <div className="border-hairline px-row-x flex h-11 shrink-0 items-center gap-1 border-b">
        <IconButton
          size="sm"
          label="Show output"
          shortcut={SHOW_HINT}
          icon={<ChevronLeftIcon size={14} />}
          onClick={open}
        />
        <span className="text-label text-text-default">Output</span>
      </div>
      <div className="py-row-x flex min-h-0 flex-1 flex-col overflow-y-auto">
        {session === null ? null : (
          <Fact icon={<SessionGlyph state={session.state} harness={session.harness} />}>
            <span className="text-label text-text-default truncate">
              {capitalize(sessionStateLabel[session.state])}
            </span>
          </Fact>
        )}
        <Fact icon={<ServerIcon size={14} />}>
          <span className="text-label text-text-default truncate">{host?.label ?? hostKey}</span>
        </Fact>
        {cwd === null ? null : (
          <Fact icon={<FolderIcon size={14} />} title={cwd}>
            {/* Right-to-left so a long path loses its start, not the folder name. */}
            <span className="text-code-inline text-text-default truncate font-mono" dir="rtl">
              <bdi dir="ltr">{homePath(cwd, host?.status.host?.homeDir ?? null)}</bdi>
            </span>
          </Fact>
        )}
        <Fact icon={<BranchIcon size={14} />}>
          <span
            className={cn(
              "truncate",
              git.kind === "ready"
                ? "text-code-inline text-text-default font-mono"
                : "text-caption text-text-subtle"
            )}
          >
            {branchText(git)}
          </span>
        </Fact>
        {git.kind === "ready" ? (
          <button
            type="button"
            onClick={open}
            className="hover:bg-fill-hover h-row px-row-x gap-row-x flex cursor-default items-center text-left"
            data-testid="output-rail-changes"
          >
            <span className="size-4 shrink-0" />
            <span className="text-label text-text-default tabular min-w-0 flex-1 truncate">
              {changesText(git)}
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
};
