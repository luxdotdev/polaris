/**
 * "Open in terminal": `OpenInTerminal`, then the Harness's own terminal UI
 * (`session.terminalCommand`) in a drawer tab. Codex's TUI co-attaches; Claude
 * hands off, and the session stays In Terminal until "Take back"
 * (`ReturnFromTerminal`), which also closes the tab.
 */
import type { SessionId, TerminalLaunch } from "@polaris/protocol";
import { Commands } from "../../commands.ts";
import { send, showRefusal } from "../session/dispatch.ts";
import { polaris } from "../bridge.ts";
import { closeTab, runInTerminal, type TerminalPlace } from "./actions.ts";
import { argvOf } from "./model/launch.ts";
import { handoffKey } from "./model/tabs.ts";

/** The command appears shortly after the ack; give the Harness this long. */
const COMMAND_WAIT_MS = 10_000;

const POLL_MS = 200;

export interface HandoffTarget extends TerminalPlace {
  readonly sessionId: SessionId;
  /** The tab's title, e.g. "Claude Code · Fix the flaky test". */
  readonly title: string;
}

const waitForCommand = async (hostKey: string, sessionId: SessionId) => {
  const deadline = performance.now() + COMMAND_WAIT_MS;

  while (performance.now() < deadline) {
    const result = await polaris().request("session.terminalCommand", { hostKey, sessionId });

    if (!result.ok) return result;

    if (result.value !== null) return { ok: true as const, value: result.value };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return {
    ok: false as const,
    error: { code: "Timeout", message: "The harness didn't give a terminal command in time" },
  };
};

/** Runs a launch in the session's hand-off tab (also used to reattach after an exit). */
export const runLaunch = (target: HandoffTarget, launch: TerminalLaunch) =>
  runInTerminal(target, {
    key: handoffKey(target.sessionId),
    title: target.title,
    cwd: launch.cwd,
    argv: argvOf(launch),
    sessionId: target.sessionId,
  });

export const openInTerminal = async (target: HandoffTarget, alreadyInTerminal: boolean) => {
  if (!alreadyInTerminal) {
    const ok = await send(
      target.hostKey,
      Commands.OpenInTerminal({ sessionId: target.sessionId }),
      "Couldn't open in terminal"
    );

    if (!ok) return false;
  }

  const command = await waitForCommand(target.hostKey, target.sessionId);

  if (!command.ok) {
    showRefusal("Couldn't open in terminal", command.error);

    return false;
  }

  return (await runLaunch(target, command.value)) !== null;
};

export const takeBack = async (target: TerminalPlace & { readonly sessionId: SessionId }) => {
  const ok = await send(
    target.hostKey,
    Commands.ReturnFromTerminal({ sessionId: target.sessionId }),
    "Couldn't take the session back"
  );

  if (ok) closeTab(target, handoffKey(target.sessionId));

  return ok;
};
