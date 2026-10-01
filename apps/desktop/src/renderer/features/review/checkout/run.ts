/**
 * Run in a Review Checkout: the command is read from the checkout on its Host, it runs in a
 * terminal tab of the checkout's Workspace (output in Orchestrate's drawer; leaving Review
 * keeps it running), and Stop, Update and Remove end it first.
 */
import type { TerminalId } from "@polaris/protocol";
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { polaris } from "../../bridge.ts";
import { closeTab, runInTerminal } from "../../terminal/actions.ts";
import { emptyDrawer, tabOf, type TerminalTab } from "../../terminal/model/tabs.ts";
import { drawerKey, drawers } from "../../terminal/store.ts";
import type { Held } from "./actions.ts";
import { LOCKFILES, loginShellArgv, runCommandOf } from "./model/run.ts";

export const runTabKey = (held: Pick<Held, "checkout">) => `review-run:${held.checkout.id}`;

const placeOf = (held: Held) => ({ hostKey: held.hostKey, workspaceId: held.checkout.workspaceId });

/** The command per checkout and head (`undefined` while it is read). */
const commands = createStore<Readonly<Record<string, string | null>>>(() => ({}));

/** Commands being read, so a render doesn't read the same checkout twice. */
const reading = new Set<string>();

/** When each run started (ms), by tab key; the tab itself is the drawer's. */
const started = new Map<string, number>();

const readText = async (hostKey: string, path: string) => {
  const result = await polaris().request("files.read", {
    hostKey,
    path,
    offset: null,
    length: 262_144,
  });

  if (!result.ok) return null;
  const { content } = result.value;

  return content.kind === "text" ? content.text : new TextDecoder().decode(content.bytes);
};

const exists = async (hostKey: string, path: string) =>
  (await polaris().request("files.stat", { hostKey, path })).ok;

const readCommand = async (held: Held) => {
  const root = held.checkout.path;
  const packageJson = await readText(held.hostKey, `${root}/package.json`);

  const found = await Promise.all(
    LOCKFILES.map(async ([file]) => ((await exists(held.hostKey, `${root}/${file}`)) ? file : null))
  );

  return runCommandOf(packageJson, new Set(found.filter((f) => f !== null)));
};

/** What Run would start: still being read, nothing to run, or the command. */
export type RunCommand =
  | { readonly kind: "reading" }
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly command: string };

const READING: RunCommand = { kind: "reading" };

const NONE: RunCommand = { kind: "none" };

/** What Run would start in the checkout, read once per head. */
export const useRunCommand = (held: Held | null): RunCommand => {
  const key =
    held === null || held.checkout.head === null
      ? null
      : `${held.checkout.id}@${held.checkout.head}`;

  const command = useStore(commands, (s) => (key === null || !(key in s) ? undefined : s[key]));
  const ready = held?.checkout.state === "ready" || held?.checkout.state === "stale";

  useEffect(() => {
    if (key === null || held === null || !ready) return;

    if (key in commands.getState() || reading.has(key)) return;
    reading.add(key);
    void readCommand(held).then((value) => {
      reading.delete(key);
      commands.setState({ [key]: value });
    });
  }, [key, held, ready]);

  if (key === null) return NONE;

  if (command === undefined) return READING;

  return command === null ? NONE : { kind: "found", command };
};

export interface RunState {
  readonly command: string;
  readonly startedAt: number;
}

const liveCommand = (tab: TerminalTab | undefined) =>
  tab !== undefined && (tab.status.kind === "live" || tab.status.kind === "opening")
    ? tab.title
    : null;

const runTab = (held: Held, all = drawers.getState()) =>
  tabOf(all[drawerKey(held.hostKey, held.checkout.workspaceId)] ?? emptyDrawer, runTabKey(held));

/** The checkout's run while its tab holds a live process. */
export const useRun = (held: Held | null): RunState | null => {
  // A string, not an object, so the selector is stable between renders.
  const command = useStore(drawers, (s) => (held === null ? null : liveCommand(runTab(held, s))));

  if (held === null || command === null) return null;

  return { command, startedAt: started.get(runTabKey(held)) ?? Date.now() };
};

export const startRun = (held: Held, command: string) => {
  const key = runTabKey(held);

  started.set(key, Date.now());

  return runInTerminal(placeOf(held), {
    key,
    title: command,
    cwd: held.checkout.path,
    argv: loginShellArgv(command),
  });
};

/** Ends the run and waits for the Host to close its terminal, so an update or removal isn't refused. */
export const stopRun = async (held: Held) => {
  const key = runTabKey(held);
  const place = placeOf(held);
  const tab = runTab(held);

  if (tab === undefined) return;

  if (tab.terminalId !== null && (tab.status.kind === "live" || tab.status.kind === "opening")) {
    await polaris().request("terminal.close", {
      hostKey: place.hostKey,
      // SAFETY: terminal ids come from `terminal.open` answers, persisted as strings.
      terminalId: tab.terminalId as TerminalId,
    });
  }

  started.delete(key);
  closeTab(place, key);
};

/** Whether a run is going in the checkout now (outside React). */
export const runningCommand = (held: Held): string | null => liveCommand(runTab(held));
