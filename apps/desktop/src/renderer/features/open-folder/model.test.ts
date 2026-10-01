import { describe, expect, test } from "bun:test";
import {
  browseOf,
  enter,
  expand,
  folderRows,
  listError,
  RECENT_FOLDERS,
  tilde,
  up,
  withRecentFolder,
} from "./model.ts";

const HOME = "/home/ada";

describe("browseOf", () => {
  test("starts at the Host's home", () => {
    expect(browseOf("", HOME)).toEqual({ dir: "~", absolute: HOME, filter: "" });
    expect(browseOf("~/", HOME)).toEqual({ dir: "~", absolute: HOME, filter: "" });
  });

  test("splits the folder listed from the name being typed", () => {
    expect(browseOf("~/code/pol", HOME)).toEqual({
      dir: "~/code",
      absolute: "/home/ada/code",
      filter: "pol",
    });
    expect(browseOf("/srv/", HOME)).toEqual({ dir: "/srv", absolute: "/srv", filter: "" });
    expect(browseOf("/et", HOME)).toEqual({ dir: "/", absolute: "/", filter: "et" });
  });

  test("a bare name is looked up in the home; an unknown home browses nothing", () => {
    expect(browseOf("co", HOME)).toEqual({ dir: "~", absolute: HOME, filter: "co" });
    expect(browseOf("~/code/", null).absolute).toBeNull();
    expect(browseOf("/srv/", null).absolute).toBe("/srv");
  });
});

describe("paths", () => {
  test("expand and tilde are inverses under the home", () => {
    expect(expand("~/code/", HOME)).toBe("/home/ada/code");
    expect(expand("~", HOME)).toBe(HOME);
    expect(tilde("/home/ada/code", HOME)).toBe("~/code");
    expect(tilde(HOME, HOME)).toBe("~");
    expect(tilde("/home/adam", HOME)).toBe("/home/adam");
    expect(tilde("/srv", "/")).toBe("/srv");
  });

  test("entering and leaving a folder", () => {
    expect(enter("/home/ada/code", HOME)).toBe("~/code/");
    expect(enter("/", HOME)).toBe("/");
    expect(up("~/code/polaris/", HOME)).toBe("~/code/");
    expect(up("~/code/pol", HOME)).toBe("~/");
    expect(up("~/", HOME)).toBe("/home/");
    expect(up("/srv/data/", HOME)).toBe("/srv/");
    expect(up("/", HOME)).toBe("/");
  });
});

describe("folderRows", () => {
  const entries = [
    { name: "polaris", path: "/c/polaris", kind: "directory" as const },
    { name: "notes.md", path: "/c/notes.md", kind: "file" as const },
    { name: ".config", path: "/c/.config", kind: "directory" as const },
    { name: "apollo", path: "/c/apollo", kind: "symlink" as const },
    { name: "Pixels", path: "/c/Pixels", kind: "directory" as const },
  ];

  test("every folder and link, by name, dot-folders after the others", () => {
    expect(folderRows(entries, "", []).map((r) => r.name)).toEqual([
      "apollo",
      "Pixels",
      "polaris",
      ".config",
    ]);
  });

  test("prefix matches rank before matches inside the name, ignoring case", () => {
    expect(folderRows(entries, "po", []).map((r) => r.name)).toEqual(["polaris", "apollo"]);
    expect(folderRows(entries, "PIX", []).map((r) => r.name)).toEqual(["Pixels"]);
  });

  test("a dot-folder matches like any other; at the same rank it comes last", () => {
    expect(folderRows(entries, ".c", []).map((r) => r.name)).toEqual([".config"]);
    expect(folderRows(entries, "con", []).map((r) => r.name)).toEqual([".config"]);
    expect(
      folderRows([...entries, { name: ".pol", path: "/c/.pol", kind: "directory" }], "pol", []).map(
        (r) => r.name
      )
    ).toEqual(["polaris", ".pol", "apollo"]);
  });

  test("marks folders that are already workspaces", () => {
    const rows = folderRows(entries, "pol", [{ path: "/c/polaris", name: "polaris" }]);

    expect(rows[0]?.workspace).toBe("polaris");
  });
});

describe("recent folders", () => {
  test("newest first per Host, without duplicates, capped", () => {
    let recent = withRecentFolder({}, "local", "/a");

    recent = withRecentFolder(recent, "studio", "/s");
    recent = withRecentFolder(recent, "local", "/b");
    recent = withRecentFolder(recent, "local", "/a");
    expect(recent).toEqual({ local: ["/a", "/b"], studio: ["/s"] });

    for (let i = 0; i < 10; i++) recent = withRecentFolder(recent, "local", `/x${i}`);
    expect(recent.local).toHaveLength(RECENT_FOLDERS);
  });
});

test("list errors say what happened", () => {
  expect(listError("ENOENT: no such file or directory, scandir '/x'", "~/x")).toBe(
    "No folder at ~/x"
  );
  expect(listError("EACCES: permission denied", "/root")).toBe("Can't read /root");
  expect(listError("ENOTDIR: not a directory", "~/a.md")).toBe("~/a.md isn't a folder");
  expect(listError("boom", "/y")).toBe("Couldn't list /y");
});
