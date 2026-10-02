/**
 * The editor's side of E3: which agent session is editing an open file
 * (`setAgentEdits`, fed by the explorer), its writes marked as the reload
 * brings them in, and Follow scrolling to them.
 */
import type { EditorState, StateEffect } from "@codemirror/state";
import { harnessHue } from "@polaris/ui";
import { agentCleared, agentField, agentWrote } from "../cm/agent.ts";
import type { EditorFile } from "../cm/extensions.ts";
import type { Span } from "../cm/reload.ts";
import type { AgentEdit } from "../model/agent.ts";
import { workspaceKey } from "../model/drafts.ts";
import { editorStore } from "./store.ts";

export const agentEditOf = (file: EditorFile): AgentEdit | null =>
  editorStore.getState().agentEdits[workspaceKey(file.hostKey, file.workspaceId)]?.get(file.path) ??
  null;

export interface AgentReload {
  /** The agent's marks for what it just wrote. */
  readonly effects: ReadonlyArray<StateEffect<unknown>>;
  /** Follow: where to scroll once the reload is in. */
  readonly follow: number | null;
}

/** When an agent is editing the file, a reload's changes are its writes: marked, and followed. */
export const agentReload = (
  file: EditorFile,
  spans: ReadonlyArray<Span>,
  active: boolean
): AgentReload => {
  const edit = agentEditOf(file);
  const last = spans.at(-1);

  if (edit === null || last === undefined) return { effects: [], follow: null };
  const name = harnessHue(edit.harness).name;

  const effects = spans.map((s) =>
    agentWrote.of({ turnId: edit.turnId, harness: edit.harness, name, from: s.from, to: s.to })
  );

  return { effects, follow: active && editorStore.getState().follow ? last.to : null };
};

/** The marks to drop when the agent stopped editing the file, or a new Turn began. */
export const staleAgent = (file: EditorFile, state: EditorState): StateEffect<null> | null => {
  const marks = state.field(agentField, false) ?? null;

  if (marks === null) return null;
  const edit = agentEditOf(file);

  return edit === null || edit.turnId !== marks.turnId ? agentCleared.of(null) : null;
};
