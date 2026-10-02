import { describe, expect, test } from "bun:test";
import { bannerFor } from "./banner.ts";
import { createDraftStore, memorySpill } from "./draftStore.ts";
import { loaded } from "./buffer.ts";
import {
  draftMatches,
  listDrafts,
  MAX_DRAFT_CHARS,
  memoryKeyValue,
  readDraft,
  readTabs,
  writeDraft,
  writeTabs,
} from "./drafts.ts";
import { detectIndent, indentLabel, lineSeparatorOf } from "./indent.ts";
import { languageFor } from "./language.ts";
import { closeTab, cycleTab, emptyTabs, openTab, pinTab, renameTab, tabLabels } from "./tabs.ts";
import { modeLabel, modeText } from "./vim.ts";
import { unreadableToast } from "./notices.ts";
import { crumbs } from "./paths.ts";
import type { BufferView } from "../runtime/store.ts";

describe("tabs", () => {
  test("a preview is replaced by the next preview, and pinned by opening it for real", () => {
    const a = openTab(emptyTabs, "/a", true);
    const b = openTab(a, "/b", true);

    expect(b.tabs).toEqual([{ path: "/b", preview: true }]);
    expect(openTab(b, "/b", false).tabs).toEqual([{ path: "/b", preview: false }]);
    expect(pinTab(b, "/b").tabs[0]?.preview).toBe(false);
  });

  test("new tabs open after the active one", () => {
    let set = openTab(emptyTabs, "/a", false);

    set = openTab(set, "/b", false);
    set = { ...set, active: "/a" };
    set = openTab(set, "/c", false);

    expect(set.tabs.map((t) => t.path)).toEqual(["/a", "/c", "/b"]);
  });

  test("closing the active tab activates its right neighbour, else the left", () => {
    const set = ["/a", "/b", "/c"].reduce((s, p) => openTab(s, p, false), emptyTabs);

    expect(closeTab({ ...set, active: "/b" }, "/b").active).toBe("/c");
    expect(closeTab(set, "/c").active).toBe("/b");
    expect(closeTab(openTab(emptyTabs, "/a", false), "/a").active).toBeNull();
  });

  test("cycling wraps, renames follow the file", () => {
    const set = ["/a", "/b"].reduce((s, p) => openTab(s, p, false), emptyTabs);

    expect(cycleTab(set, 1).active).toBe("/a");
    expect(cycleTab(set, -1).active).toBe("/a");
    expect(renameTab(set, "/b", "/z")).toEqual({
      tabs: [
        { path: "/a", preview: false },
        { path: "/z", preview: false },
      ],
      active: "/z",
    });
  });

  test("a moved folder takes its tabs along", () => {
    const set = ["/r/a/x.ts", "/r/ab.ts"].reduce((s, p) => openTab(s, p, false), emptyTabs);

    expect(renameTab(set, "/r/a", "/r/b").tabs.map((t) => t.path)).toEqual([
      "/r/b/x.ts",
      "/r/ab.ts",
    ]);
  });

  test("same-named files get the shortest distinct parent", () => {
    expect(tabLabels(["/x/hosts/index.ts", "/x/files/index.ts", "/x/a.ts"])).toEqual([
      "hosts/index.ts",
      "files/index.ts",
      "a.ts",
    ]);
  });
});

describe("drafts", () => {
  const version = { mtimeMs: 1, size: 3, hash: "h" };

  test("kept per Host and path, and survive a reload of storage", () => {
    const kv = memoryKeyValue();

    expect(
      writeDraft(kv, { hostKey: "studio", path: "/a.ts", text: "abc", base: version }, 5)
    ).toBe(true);
    expect(readDraft(kv, "studio", "/a.ts")).toEqual({
      hostKey: "studio",
      path: "/a.ts",
      text: "abc",
      base: version,
      savedAt: 5,
    });
    expect(readDraft(kv, "pi", "/a.ts")).toBeNull();
  });

  test("a draft past the inline budget isn't kept inline, and no other draft is evicted", () => {
    const kv = memoryKeyValue();

    expect(
      writeDraft(kv, {
        hostKey: "h",
        path: "/big",
        text: "x".repeat(MAX_DRAFT_CHARS + 1),
        base: null,
      })
    ).toBe(false);
    expect(
      writeDraft(kv, { hostKey: "h", path: "/1", text: "x".repeat(1_500_000), base: null }, 1)
    ).toBe(true);
    expect(
      writeDraft(kv, { hostKey: "h", path: "/2", text: "x".repeat(1_500_000), base: null }, 2)
    ).toBe(true);
    expect(
      writeDraft(kv, { hostKey: "h", path: "/3", text: "x".repeat(1_500_000), base: null }, 3)
    ).toBe(false);
    expect(
      listDrafts(kv)
        .map((d) => d.path)
        .toSorted()
    ).toEqual(["/1", "/2"]);
  });

  test("past the inline budget a draft spills; with nowhere to go it isn't kept and says so", async () => {
    const kv = memoryKeyValue();
    const spill = memorySpill();

    writeDraft(kv, { hostKey: "h", path: "/1", text: "x".repeat(1_900_000), base: null });
    writeDraft(kv, { hostKey: "h", path: "/2", text: "x".repeat(1_900_000), base: null });
    expect(
      createDraftStore(kv, spill).write({
        hostKey: "h",
        path: "/3",
        text: "y".repeat(400_000),
        base: null,
      })
    ).toBe(true);
    expect((await createDraftStore(kv, spill).read("h", "/3"))?.text.length).toBe(400_000);
    expect(
      createDraftStore(kv, null).write({
        hostKey: "h",
        path: "/4",
        text: "z".repeat(400_000),
        base: null,
      })
    ).toBe(false);
    expect(createDraftStore(kv, null).has("h", "/4")).toBe(false);
  });

  test("a draft matches the disk it was made on", () => {
    const draft = { hostKey: "h", path: "/a", text: "x", base: version, savedAt: 0 };

    expect(draftMatches(draft, version)).toBe(true);
    expect(draftMatches(draft, { ...version, hash: "other" })).toBe(false);
    expect(draftMatches({ ...draft, base: null }, null)).toBe(true);
  });

  test("tabs round-trip, and garbage reads as none", () => {
    const kv = memoryKeyValue();
    const tabs = { "h\u0000w": { tabs: [{ path: "/a", preview: false }], active: "/a" } };

    writeTabs(kv, tabs);
    expect(readTabs(kv)).toEqual(tabs);
    kv.setItem("polaris.editor.tabs.v1", "{nope");
    expect(readTabs(kv)).toEqual({});
  });
});

describe("big drafts (QCHECK: over 2M characters were lost)", () => {
  const version = { mtimeMs: 1, size: 3, hash: "h" };

  test("a 3 MB edit spills to the big store and reads back whole", async () => {
    const kv = memoryKeyValue();
    const spill = memorySpill();
    const store = createDraftStore(kv, spill);
    const text = "x".repeat(3_000_000);

    expect(store.write({ hostKey: "h", path: "/big.ts", text, base: version })).toBe(true);
    expect(store.has("h", "/big.ts")).toBe(true);
    expect(readDraft(kv, "h", "/big.ts")?.text).toBe("");
    expect((await store.read("h", "/big.ts"))?.text.length).toBe(3_000_000);

    store.drop("h", "/big.ts");
    await Promise.resolve();
    expect(store.has("h", "/big.ts")).toBe(false);
    expect(spill.size()).toBe(0);
  });

  test("a big draft that shrinks moves back inline, and small ones never spill", async () => {
    const kv = memoryKeyValue();
    const spill = memorySpill();
    const store = createDraftStore(kv, spill);

    store.write({ hostKey: "h", path: "/a.ts", text: "y".repeat(600_000), base: null });
    store.write({ hostKey: "h", path: "/a.ts", text: "small", base: null });
    await Promise.resolve();
    expect((await store.read("h", "/a.ts"))?.text).toBe("small");
    expect(spill.size()).toBe(0);
  });
});

describe("files", () => {
  test("languages by extension, name and shebang", () => {
    expect(languageFor("/x/reconnect.ts")).toBe("typescript");
    expect(languageFor("/x/Row.TSX")).toBe("tsx");
    expect(languageFor("/x/Cargo.lock")).toBe("toml");
    expect(languageFor("/x/run", "#!/usr/bin/env bash")).toBe("shell");
    expect(languageFor("/x/LICENSE")).toBe("plain");
  });

  test("indentation is guessed from the file", () => {
    expect(detectIndent("a\n  b\n    c\n  d\n")).toEqual({ tabs: false, width: 2 });
    expect(detectIndent("a\n    b\n        c\n")).toEqual({ tabs: false, width: 4 });
    expect(detectIndent("a\n\tb\n\t\tc\n")).toEqual({ tabs: true, width: 4 });
    expect(indentLabel({ tabs: false, width: 2 })).toBe("Spaces 2");
  });

  test("CRLF files keep their endings", () => {
    expect(lineSeparatorOf("a\r\nb\r\n")).toBe("\r\n");
    expect(lineSeparatorOf("a\nb")).toBe("\n");
  });
});

describe("the strip above the code", () => {
  const view = (patch: Partial<BufferView>): BufferView => ({
    status: {
      kind: "ready",
      model: loaded({ text: "a", version: { mtimeMs: 1, size: 1, hash: "a" } }),
    },
    language: "typescript",
    deleted: false,
    readOnly: false,
    draft: false,
    grammar: true,
    unkept: false,
    ...patch,
  });

  test("a conflict names who changed it, with its three actions", () => {
    const model = {
      ...loaded({ text: "a", version: { mtimeMs: 1, size: 1, hash: "a" } }),
      conflict: {
        theirs: { text: "b", version: { mtimeMs: 2, size: 1, hash: "b" } },
        by: "Claude Code",
      },
    };

    const banner = bannerFor(view({ status: { kind: "ready", model } }), "Mac Studio");

    expect(banner?.text).toBe("Changed on disk by Claude Code");
    expect(banner?.actions.map((a) => a.label)).toEqual(["Compare", "Keep mine", "Take theirs"]);
  });

  test("an edit too large to keep says so, with Save", () => {
    const model = {
      ...loaded({ text: "a", version: { mtimeMs: 1, size: 1, hash: "a" } }),
      dirty: true,
    };

    const banner = bannerFor(
      view({ status: { kind: "ready", model }, unkept: true }),
      "Mac Studio"
    );

    expect(banner?.text).toBe("This unsaved edit is too large to keep after quitting");
    expect(banner?.actions.map((a) => a.label)).toEqual(["Save"]);
  });

  test("an old Daemon says so, and nothing shows when all is well", () => {
    expect(bannerFor(view({ readOnly: true }), "Raspberry Pi 4")?.text).toBe(
      "The daemon on Raspberry Pi 4 can't save files yet"
    );
    expect(bannerFor(view({}), "Mac Studio")).toBeNull();
  });
});

describe("an open that can't read its file", () => {
  test("says which file, and on which host", () => {
    expect(
      unreadableToast(
        "/r/daemon/gone.ts",
        "/r",
        { label: "Mac Studio", home: null },
        { kind: "missing" }
      )
    ).toEqual({
      title: "Couldn't open daemon/gone.ts",
      message: "Not found on Mac Studio.",
    });
  });

  test("passes the Daemon's reason through, and the whole path outside the root", () => {
    expect(
      unreadableToast(
        "/etc/shadow",
        "/r",
        { label: "Linux VM", home: "/home/lucas" },
        {
          kind: "error",
          message: "EACCES: permission denied.",
        }
      )
    ).toEqual({
      title: "Couldn't open etc/shadow",
      message: "EACCES: permission denied (on Linux VM).",
    });
  });
});

describe("paths in the breadcrumbs", () => {
  test("from the root, else from ~ (a checkout's other files), else from /", () => {
    expect(crumbs("/Users/l/code/p/daemon/a.ts", "/Users/l/code/p")).toEqual(["daemon", "a.ts"]);
    expect(crumbs("/Users/l/code/p/x.ts", "/Users/l/.review/p", "/Users/l")).toEqual([
      "~",
      "code",
      "p",
      "x.ts",
    ]);
    expect(crumbs("/opt/x.ts", "/r", "/Users/l")).toEqual(["opt", "x.ts"]);
  });

  test("a macOS realpath under /private is inside a /var root (QDESIGN #4)", () => {
    expect(crumbs("/private/var/folders/t/repo/README.md", "/var/folders/t/repo")).toEqual([
      "README.md",
    ]);
  });
});

describe("vim", () => {
  test("modes from codemirror-vim's events", () => {
    expect(modeLabel("visual", "linewise")).toBe("visual line");
    expect(modeLabel("insert")).toBe("insert");
    expect(modeLabel("unknown")).toBe("normal");
    expect(modeText("visual block")).toBe("VISUAL BLOCK");
  });
});
