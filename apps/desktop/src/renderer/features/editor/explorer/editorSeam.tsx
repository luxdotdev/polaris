/**
 * The editor core's interface as agreed with M3-CORE (`features/editor/index.ts`):
 * a stand-in until it lands, then this file re-exports it. Paths are absolute on the Host.
 */
import { Facet, type Extension } from "@codemirror/state";
import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";

export interface EditorFile {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly path: string;
}

/** The file a tab's EditorState holds; read it from `view.state`, never cache it. */
export const editorFile = Facet.define<EditorFile, EditorFile | null>({
  combine: (values) => values[0] ?? null,
});

export interface OpenFile extends EditorFile {
  readonly line?: number;
  readonly column?: number;
  /** Replaces the current preview tab; editing or a double-click pins it. */
  readonly preview?: boolean;
}

export interface EditorTabs {
  readonly paths: ReadonlyArray<string>;
  readonly active: string | null;
  readonly dirty: ReadonlySet<string>;
}

const noTabs: EditorTabs = { paths: [], active: null, dirty: new Set() };

const tabs = createStore<Readonly<Record<string, EditorTabs>>>(() => ({}));

const tabsKey = (hostKey: string, workspaceId: string) => `${hostKey}\u0000${workspaceId}`;

export const openFile = ({ hostKey, workspaceId, path }: OpenFile) => {
  const key = tabsKey(hostKey, workspaceId);
  const current = tabs.getState()[key] ?? noTabs;
  const paths = current.paths.includes(path) ? current.paths : [...current.paths, path];

  tabs.setState({ ...tabs.getState(), [key]: { ...current, paths, active: path } });
};

export const closeTab = (hostKey: string, workspaceId: string, path: string) => {
  const key = tabsKey(hostKey, workspaceId);
  const current = tabs.getState()[key] ?? noTabs;
  const paths = current.paths.filter((p) => p !== path);

  tabs.setState({
    ...tabs.getState(),
    [key]: {
      ...current,
      paths,
      active: current.active === path ? (paths.at(-1) ?? null) : current.active,
    },
  });
};

export const useEditorTabs = (hostKey: string, workspaceId: string): EditorTabs =>
  useSyncExternalStore(
    tabs.subscribe,
    () => tabs.getState()[tabsKey(hostKey, workspaceId)] ?? noTabs
  );

const agentFiles = new Map<string, ReadonlyMap<string, string>>();

/** Which open files an agent is changing, for the tabs' 12px dither. */
export const setAgentFiles = (
  hostKey: string,
  workspaceId: string,
  files: ReadonlyMap<string, string>
) => {
  agentFiles.set(tabsKey(hostKey, workspaceId), files);
};

const registrations = new Set<(file: EditorFile) => ReadonlyArray<Extension>>();

/** Adds CodeMirror extensions to every tab's state; returns the unregister. */
export const registerEditorExtensions = (
  factory: (file: EditorFile) => ReadonlyArray<Extension>
) => {
  registrations.add(factory);

  return () => {
    registrations.delete(factory);
  };
};

/** The stand-in's registrations, for its own tests. */
export const editorExtensionsFor = (file: EditorFile): ReadonlyArray<Extension> => [
  editorFile.of(file),
  ...[...registrations].flatMap((factory) => factory(file)),
];

export interface EditorPaneProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly root: string;
}

/** Tabs, breadcrumbs, the editor and its banners; the stand-in names the active file. */
export const EditorPane = ({ hostKey, workspaceId }: EditorPaneProps) => {
  const { active } = useEditorTabs(hostKey, workspaceId);

  return (
    <div className="bg-bg text-caption text-text-subtle flex min-w-0 flex-1 items-center justify-center">
      {active ?? "No file open"}
    </div>
  );
};

/** The status bar's right part: position, indentation, language, vim mode. */
export const EditorStatus: (props: {
  readonly hostKey: string;
  readonly workspaceId: string;
}) => null = () => null;
