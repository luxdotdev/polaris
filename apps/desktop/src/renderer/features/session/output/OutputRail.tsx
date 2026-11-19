/**
 * Output collapsed (DESIGN.md, Output; Paper 0.11.0 R1, R2): a 240px status view of the
 * session (Activity, Changes, Where, Tools), so the conversation gets the room. The session's
 * first edit opens the panel, once; so do the chevron, the Changes rows, Browser, Simulator and ⌘⌥B.
 */
import { ChevronLeftIcon, cn, IconButton } from "@polaris/ui";
import type { TurnId } from "@polaris/protocol";
import { Predicate } from "effect";
import { useEffect, useRef } from "react";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { useHost, useSession } from "../hooks.ts";
import { uiKey } from "../state.ts";
import { openForEdit, setOutputOpen } from "./open.ts";
import { diffRevision, useTurnDiff } from "../turnDiff.ts";
import type { SessionViewProps } from "../ui/SessionIntent.tsx";
import { useGitFacts } from "./gitStatus.ts";
import { RAIL_WIDTH } from "./layout.ts";
import { useSettings } from "../../settings/index.ts";
import { useFilesTick } from "./watch.ts";
import { commandShortcut } from "../../../../shared/keymap.ts";
import { ActivityBlock } from "./rail/activity.tsx";
import { ChangesBlock } from "./rail/changes.tsx";
import { ROW } from "./rail/parts.tsx";
import { ToolsBlock } from "./rail/tools.tsx";
import { WhereBlock } from "./rail/where.tsx";

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

export const showHint = () => commandShortcut("view.output");

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
    edits || turnId === null ? null : { first: turnId, last: turnId },
    latest === null ? "" : diffRevision(latest, tick)
  );

  const edited = edits || (diff.kind === "ready" && diff.files.length > 0);

  useToastInset();
  const autoOpen = useSettings((s) => s.sessions.openOutputOnEdit);

  useEffect(() => {
    if (autoOpen && edited && turnId !== null) openForEdit(key);
  }, [autoOpen, edited, key, turnId]);

  const open = () => setOutputOpen(key, true);
  const harness = model.session?.harness ?? "starlight";
  const away = host !== undefined && host.status.state !== "connected";

  return (
    <section aria-label="Output" className="flex min-h-0 flex-1 flex-col" data-testid="output-rail">
      <div className={cn(ROW, "h-11 shrink-0")}>
        <IconButton
          size="sm"
          label="Show output"
          shortcut={showHint()}
          icon={<ChevronLeftIcon size={14} />}
          onClick={open}
          className="-mx-1.5"
        />
        <span className="text-label text-text-default flex-1">Output</span>
        <span className="text-text-faint font-mono text-[11px]" aria-hidden>
          {showHint()}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ActivityBlock hostKey={hostKey} sessionId={sessionId} model={model} />
        <ChangesBlock hostKey={hostKey} sessionId={sessionId} model={model} tick={tick} git={git} />
        <WhereBlock hostKey={hostKey} sessionId={sessionId} model={model} git={git} />
        <ToolsBlock hostKey={hostKey} sessionId={sessionId} harness={harness} away={away} />
      </div>
    </section>
  );
};
