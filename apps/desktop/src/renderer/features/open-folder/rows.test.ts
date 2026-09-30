import { describe, expect, test } from "bun:test";
import { HostId, HostInfo } from "@polaris/protocol";
import type { HostView } from "../../../shared/api.ts";
import { hostView } from "../../routes/fixtures.testing.ts";
import { buildGroups, emptyLine } from "./rows.ts";
import type { Listing } from "./useListing.ts";

const HOME = "/home/ada";

const withHome = (key: string): HostView => {
  const view = hostView(key);

  return {
    ...view,
    status: {
      ...view.status,
      host: new HostInfo({
        hostId: HostId.make(`h-${key}`),
        hostname: key,
        platform: "linux-arm64",
        daemonVersion: "0.1.0",
        homeDir: HOME,
        startedAt: "2026-09-30T00:00:00.000Z",
      }),
    },
  };
};

const listed: Listing = {
  kind: "listed",
  entries: [
    { name: "code", path: `${HOME}/code`, kind: "directory", size: 0, modifiedAt: "" },
    { name: "notes.md", path: `${HOME}/notes.md`, kind: "file", size: 1, modifiedAt: "" },
  ],
};

const titles = (groups: ReturnType<typeof buildGroups>) =>
  groups.map((g) => [g.heading, ...g.rows.map((r) => r.title)]);

describe("buildGroups", () => {
  test("a remote Host at its home: recent folders, then Open ~ and its folders", () => {
    const groups = buildGroups({
      host: withHome("studio"),
      typed: "~/",
      listing: listed,
      workspaces: [],
      recent: [`${HOME}/code/polaris`],
    });

    expect(titles(groups)).toEqual([
      ["Recent", "~/code/polaris"],
      ["~", "Open ~", "code"],
    ]);
  });

  test("this Mac adds Finder; a filter drops Open and recent folders", () => {
    const groups = buildGroups({
      host: withHome("local"),
      typed: "~/co",
      listing: listed,
      workspaces: [{ path: `${HOME}/code`, name: "code" }],
      recent: [`${HOME}/x`],
    });

    expect(titles(groups)).toEqual([
      ["~", "code"],
      ["local", "Choose in Finder…"],
    ]);
    expect(groups[0]?.rows[0]?.meta).toBe("workspace");
  });

  test("nothing listed yet, or a failure: no folder rows", () => {
    const input = { host: withHome("studio"), typed: "~/nope/", workspaces: [], recent: [] };

    expect(buildGroups({ ...input, listing: { kind: "loading" } })).toEqual([]);
    expect(emptyLine("~/nope/", { kind: "failed", message: "ENOENT: no such file" }, HOME)).toBe(
      "No folder at ~/nope"
    );
    expect(emptyLine("~/code/zz", listed, HOME)).toBe("No folder in ~/code matches zz");
  });
});
