/**
 * Diff tabs (DESIGN.md, Editor: diff tabs): a changed file against the index or HEAD, opened
 * from the Changes tab, drawn by Pierre as Review is, by line or syntax-aware.
 */
import type { TabView } from "../runtime/hooks.ts";
import type { DiffTab } from "./data/tabs.ts";
import { diffTitle } from "./model/target.ts";

export {
  activateDiffTab,
  closeDiffTab,
  type DiffTab,
  openDiff,
  pinDiffTab,
  useDiffTabs,
  useShownDiff,
} from "./data/tabs.ts";

export { changeTarget, useCanDiff, useChangeOpener, useOpenChanges } from "./data/openChanges.ts";

export {
  type DiffSide,
  type DiffTarget,
  diffTabId,
  isDiffTab,
  selectedPath,
  targetOf,
} from "./model/target.ts";

export { DiffTabBody } from "./ui/DiffTab.tsx";

/** Diff tabs in the strip, after the file tabs: "main.ts (Working Tree)". */
export const diffTabViews = (tabs: ReadonlyArray<DiffTab>): Array<TabView> =>
  tabs.map((tab) => ({
    id: tab.id,
    view: "diff",
    path: tab.target.path,
    label: diffTitle(tab.target),
    preview: tab.preview,
    dirty: false,
    agent: null,
  }));
