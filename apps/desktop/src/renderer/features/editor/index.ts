/**
 * The Editor's core (M3, spec §3–4): CodeMirror 6 editors per open file,
 * tabs per Workspace, buffers that keep unsaved edits across restarts and
 * save against the version on disk, the conflict banner, and vim mode.
 * The explorer (`./explorer`) and the ⌘P / ⌘I / ⌘L features plug in here.
 */
export { EditorPane, type EditorPaneProps } from "./ui/EditorPane.tsx";

export { EditorStatus, type EditorStatusProps } from "./ui/EditorStatus.tsx";

export {
  activateTab,
  closeTab,
  cycleTabs,
  type OpenFileRequest,
  openFile,
  pinFile,
  renameFile,
  saveFile,
  setAgentEdits,
  setAgentFiles,
  setFollow,
} from "./runtime/actions.ts";

export type { AgentEdit } from "./model/agent.ts";

export {
  getActiveEditor,
  type TabView,
  type TabsView,
  useActiveEditor,
  useEditorTabs,
} from "./runtime/hooks.ts";

export type { ActiveEditor } from "./runtime/store.ts";

export { registerLazyEditorExtensions, setFileFinder } from "./api.ts";

export { dirtyKeys, saveAll } from "./runtime/buffers.ts";

export {
  type EditorExtensionFactory,
  type EditorFile,
  editorFile,
  registerEditorExtensions,
} from "./cm/extensions.ts";
