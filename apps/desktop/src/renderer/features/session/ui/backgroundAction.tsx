/**
 * "Run in background" on a running command (ENG-387), where the Host and the session's
 * Harness can move it: the command keeps running as a background task and the Turn goes on.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@polaris/ui";
import { commandShortcut } from "../../../../shared/keymap.ts";
import { useApp } from "../../../shell/hooks.ts";
import { useHarnessModels } from "../../harness/index.ts";
import { runInBackground } from "../dispatch.ts";
import { hasCapability, useHost } from "../hooks.ts";
import { type SessionTarget, useSessionTarget } from "./polarisTool/target.ts";

const Action = ({ target, itemId }: { target: SessionTarget; itemId: string }) => {
  const { hostKey, sessionId } = target;
  const host = useHost(hostKey);
  const harness = useApp((s) => s.hostModels[hostKey]?.sessions.get(sessionId)?.session.harness);
  const capable = harness !== undefined && hasCapability(host, "session.background-command");
  const { backgroundsCommands } = useHarnessModels(hostKey, harness ?? "", capable);

  if (!capable || !backgroundsCommands) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void runInBackground(hostKey, sessionId, itemId)}
          className="text-caption text-text-subtle hover:text-text-default shrink-0 cursor-default opacity-0 group-focus-within/command:opacity-100 group-hover/command:opacity-100 focus-visible:opacity-100"
        >
          Run in background
        </button>
      </TooltipTrigger>
      <TooltipContent shortcut={commandShortcut("session.background")}>
        Keep running as a background task
      </TooltipContent>
    </Tooltip>
  );
};

/** The action, in a running command's row inside a session's conversation; nothing elsewhere. */
export const BackgroundAction = ({ itemId }: { readonly itemId: string }) => {
  const target = useSessionTarget();

  return target === null ? null : <Action target={target} itemId={itemId} />;
};
