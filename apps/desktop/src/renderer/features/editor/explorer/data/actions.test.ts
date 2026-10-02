import { beforeEach, describe, expect, test } from "bun:test";
import type { PolarisApi } from "../../../../../shared/api.ts";
import { standInBridge } from "../../../bridge.ts";
import { commitDraft, deleteEntry, movedState, type Place, startDraft } from "./actions.ts";
import { emptyExplorer, explorerOf, resetExplorers } from "./store.ts";

const place: Place = { key: "h\u0000w", hostKey: "h", workspaceId: "w", root: "/w" };

/** A request's input as the explorer sends it: host, paths and flags. */
type Sent = Readonly<Record<string, string | boolean>>;

const calls: Array<[string, Sent]> = [];

let answer: (
  method: string
) => { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

const entry = (path: string) => ({
  name: path.split("/").at(-1),
  path,
  kind: "file",
  size: 0,
  modifiedAt: "",
});

beforeEach(() => {
  calls.length = 0;
  resetExplorers();

  const values = new Map<string, unknown>([
    ["files.listDir", []],
    ["files.delete", { method: "trash" }],
  ]);

  answer = (method) => ({ ok: true, value: values.get(method) ?? entry("/w/x") });

  standInBridge({
    // SAFETY: the tests answer only the explorer's file methods, with their output shapes.
    request: ((method: string, input: Sent) => {
      calls.push([method, input]);

      return Promise.resolve(answer(method));
    }) as PolarisApi["request"],
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  });
});

const sent = (method: string) => calls.flatMap(([m, input]) => (m === method ? [input] : []));

describe("commitDraft", () => {
  test("a new file in a folder: created, the folder opened and re-listed, the draft gone", async () => {
    startDraft(place.key, { kind: "create", dir: "/w/src", entry: "directory" });
    await commitDraft(place, "lib");

    expect(sent("files.create")).toEqual([{ hostKey: "h", path: "/w/src/lib", kind: "directory" }]);
    expect(sent("files.listDir")).toEqual([{ hostKey: "h", path: "/w/src" }]);
    expect(explorerOf(place.key).draft).toBeNull();
    expect(explorerOf(place.key).expanded.has("/w/src")).toBe(true);
  });

  test("a rename sends the new path beside the old one", async () => {
    startDraft(place.key, { kind: "rename", path: "/w/a.ts" });
    await commitDraft(place, "b.ts");

    expect(sent("files.rename")).toEqual([
      { hostKey: "h", path: "/w/a.ts", destination: "/w/b.ts" },
    ]);
    expect(explorerOf(place.key).focused).toBe("/w/b.ts");
  });

  test("an empty name cancels; a bad one keeps the draft for fixing; the same name does nothing", async () => {
    startDraft(place.key, { kind: "rename", path: "/w/a.ts" });
    await commitDraft(place, "../x");
    expect(explorerOf(place.key).draft).not.toBeNull();

    await commitDraft(place, "a.ts");
    expect(sent("files.rename")).toEqual([]);

    startDraft(place.key, { kind: "create", dir: "/w", entry: "file" });
    await commitDraft(place, "  ");
    expect(explorerOf(place.key).draft).toBeNull();
    expect(sent("files.create")).toEqual([]);
  });
});

describe("movedState", () => {
  test("a renamed folder keeps its open folders and drops its stale listings", () => {
    const before = {
      ...emptyExplorer,
      expanded: new Set(["/w/src", "/w/src/app", "/w/lib"]),
      listings: new Map([
        ["/w", { kind: "loading" as const }],
        ["/w/src/app", { kind: "loading" as const }],
      ]),
    };

    const after = movedState(before, "/w/src", "/w/source");

    expect([...(after.expanded ?? [])]).toEqual(["/w/source", "/w/source/app", "/w/lib"]);
    expect([...(after.listings?.keys() ?? [])]).toEqual(["/w"]);
    expect(after.focused).toBe("/w/source");
  });
});

describe("deleteEntry", () => {
  test("to the trash first; a Host without one asks before deleting for good", async () => {
    const tabs = { tabs: [], active: null };

    expect(await deleteEntry(place, "/w/a.ts", false, tabs)).toBe("done");

    answer = () => ({ ok: false, error: { code: "TrashUnavailable", message: "no trash" } });
    expect(await deleteEntry(place, "/w/a.ts", false, tabs)).toBe("confirm");
    expect(sent("files.delete").at(-1)).toEqual({
      hostKey: "h",
      path: "/w/a.ts",
      permanent: false,
    });
  });
});
