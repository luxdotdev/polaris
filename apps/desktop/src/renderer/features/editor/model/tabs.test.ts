import { describe, expect, test } from "bun:test";
import { memoryKeyValue, readTabs, writeTabs } from "./drafts.ts";
import {
  activateTab,
  activeTabId,
  closeTab,
  cycleTab,
  emptyTabs,
  followMarkdown,
  lockMarkdown,
  openMarkdown,
  openTab,
  pinTab,
  renameTab,
  tabId,
} from "./tabs.ts";

describe("Markdown view identities", () => {
  test("source preview flag stays independent, both views share one path", () => {
    const source = openTab(emptyTabs, "/a.md", true);
    const rendered = openMarkdown(source, "/a.md");
    expect(rendered.tabs.map(tabId)).toEqual(["/a.md", "markdown-preview"]);
    expect(rendered.tabs.map((t) => t.path)).toEqual(["/a.md", "/a.md"]);
    expect(rendered.tabs[0]?.preview).toBe(true);
    expect(pinTab(rendered, "/a.md").tabs[1]?.view).toBe("markdown");
    const replaced = openTab(rendered, "/b.md", true);
    expect(replaced.tabs.map(tabId)).toEqual(["/b.md", "markdown-preview"]);
  });
  test("follow retargets a stable rendered view; lock and reopen retain its document", () => {
    const rendered = openMarkdown(openTab(emptyTabs, "/a.md", false), "/a.md");
    const next = followMarkdown(openTab(rendered, "/b.md", false), "/b.md");
    expect(next.tabs.filter((t) => t.view === "markdown")[0]?.path).toBe("/b.md");
    expect(next.active).toBe("/b.md");
    const locked = lockMarkdown(next, true);
    expect(followMarkdown(locked, "/a.md")).toBe(locked);
    expect(openMarkdown(locked, "/a.md").active).toBe("/b.md");
    expect(
      followMarkdown(lockMarkdown(locked, false), "/a.md").tabs.find((t) => t.view === "markdown")
        ?.path
    ).toBe("/a.md");
  });
  test("select/cycle/close distinguish views with the same buffer path", () => {
    const rendered = openMarkdown(openTab(emptyTabs, "/a.md", false), "/a.md");
    const source = activateTab(rendered, "/a.md");
    expect(activeTabId(source)).toBe("/a.md");
    expect(activeTabId(cycleTab(source, 1))).toBe("markdown-preview");
    expect(activeTabId(cycleTab(rendered, -1))).toBe("/a.md");
    expect(closeTab(rendered, "markdown-preview")).toEqual(openTab(emptyTabs, "/a.md", false));
    expect(closeTab(rendered, "/a.md").tabs).toHaveLength(1);
    expect(closeTab(rendered, "/a.md").activeView).toBe("markdown");
    expect(closeTab(closeTab(rendered, "/a.md"), "markdown-preview")).toEqual(emptyTabs);
  });
  test("rename and restoration retain view, lock and active identity without rewriting legacy source records", () => {
    const legacy = openTab(emptyTabs, "/a.md", true);
    const rendered = lockMarkdown(openMarkdown(legacy, "/a.md"), true);
    const moved = renameTab(rendered, "/a.md", "/b.md");
    expect(moved.tabs.map((t) => t.path)).toEqual(["/b.md", "/b.md"]);
    expect(activeTabId(moved)).toBe("markdown-preview");
    const kv = memoryKeyValue();
    writeTabs(kv, { legacy, moved });
    expect(readTabs(kv)).toEqual({ legacy, moved });
    kv.setItem("polaris.editor.tabs.v1", JSON.stringify({ legacy }));
    expect(readTabs(kv)).toEqual({ legacy });
  });
});

test("restore rejects malformed rendered identities and unknown fields instead of erasing them", () => {
  const kv = memoryKeyValue();

  for (const tab of [
    { path: "/a.md", preview: false, view: "wrong" },
    { path: "/a.md", preview: false, view: "markdown", locked: "yes" },
    { path: "/a.md", preview: false, unexpectedIdentity: "lost" },
  ]) {
    kv.setItem(
      "polaris.editor.tabs.v1",
      JSON.stringify({ workspace: { tabs: [tab], active: "/a.md" } })
    );
    expect(readTabs(kv)).toEqual({});
  }
});

test("following away from a dirty rendered-only file keeps its source identity for undo and save", () => {
  const rendered = closeTab(openMarkdown(openTab(emptyTabs, "/a.md", false), "/a.md"), "/a.md");
  const next = followMarkdown(openTab(rendered, "/b.md", false), "/b.md", true);
  expect(next.tabs.find((t) => tabId(t) === "/a.md")).toEqual({ path: "/a.md", preview: false });
  expect(next.active).toBe("/b.md");
  expect(next.tabs.find((t) => t.view === "markdown")?.path).toBe("/b.md");
});
