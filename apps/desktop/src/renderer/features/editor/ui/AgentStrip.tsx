/**
 * The Working strip across an editor an agent is changing (Paper E3, 3Z7-0):
 * the Harness's dither and "Claude Code is editing this file" in its hue,
 * "{session} · turn N · elapsed", Follow (on by default) and Open session ⌘O.
 */
import { Button, Dither, harnessHue, harnessTextVar, hueVar, Kbd } from "@polaris/ui";
import { useEffect, useState } from "react";
import { useCommands, useShellActions } from "../../../shell/hooks.ts";
import { type AgentEdit, stripCaption, stripTitle } from "../model/agent.ts";
import { setFollow } from "../runtime/actions.ts";
import { useEditor } from "../runtime/store.ts";

export interface AgentStripProps {
  readonly hostKey: string;
  readonly edit: AgentEdit;
}

/** Ticks once a second, only while the strip shows (an agent is Working). */
const useNow = () => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  return now;
};

const FollowToggle = () => {
  const follow = useEditor((s) => s.follow);

  return (
    <label className="text-label text-text-default hover:bg-fill-hover rounded-control flex h-7 cursor-default items-center gap-1.5 px-2.5">
      <input
        type="checkbox"
        checked={follow}
        onChange={(event) => setFollow(event.target.checked)}
        className="peer sr-only"
        data-testid="agent-follow"
      />
      <span
        aria-hidden="true"
        className="peer-focus-visible:outline-starlight border-text-subtle peer-checked:bg-text-strong peer-checked:border-text-strong text-bg flex size-3.5 items-center justify-center rounded-[4px] border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1"
      >
        {follow ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M2 5.2l2 2L8 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      Follow
    </label>
  );
};

export const AgentStrip = ({ hostKey, edit }: AgentStripProps) => {
  const now = useNow();
  const { selectSession } = useShellActions();
  const commands = useCommands();
  const name = harnessHue(edit.harness).name;
  const { sessionId } = edit;
  const open = () => selectSession({ hostKey, sessionId });

  // ⌘O opens the session while the strip shows (the K menu's Add workspace… stays one step away).
  useEffect(
    () =>
      commands.register({
        "workspace.add": { run: () => selectSession({ hostKey, sessionId }) },
      }),
    [commands, selectSession, hostKey, sessionId]
  );

  return (
    <div
      role="status"
      data-testid="agent-strip"
      className="bg-surface-raised flex h-10 shrink-0 items-center gap-2.5 border-b pr-3 pl-5"
      style={{ borderColor: `color-mix(in srgb, ${hueVar(edit.harness)} 20%, transparent)` }}
    >
      <Dither hue={edit.harness} size={16} moving />
      <span className="text-label shrink-0" style={{ color: harnessTextVar(edit.harness) }}>
        {stripTitle(name)}
      </span>
      <span className="text-caption text-text-subtle tabular min-w-0 truncate">
        {stripCaption(edit, now)}
      </span>
      <span className="flex-1" />
      <FollowToggle />
      <Button variant="secondary" onClick={open}>
        Open session
        <Kbd variant="plain">⌘O</Kbd>
      </Button>
    </div>
  );
};
