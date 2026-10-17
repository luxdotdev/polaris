import { describe, expect, test } from "bun:test";
import { identityOf, isInTree, parseProcessTable, processTable } from "./windowsTree.ts";

const windowsOnly = test.skipIf(process.platform !== "win32");

/** `pid parent created` rows; the root (100) was started at tick 1000. */
const table = parseProcessTable(
  [
    "100 4 1000", // the spawned shim
    "200 100 1100", // node, started by it
    "9360 200 1200", // codex.exe, started by node
    "555 4 900", // an unrelated process
    // 700's parent pid 100 belonged to an older process: 700 predates the shim.
    "700 100 950",
    "800 700 1300",
    "not a row",
  ].join("\r\n")
);

const root = { pid: 100, created: 1000n };

describe("the Windows process tree", () => {
  test("holds what the started process started, and what those started", () => {
    expect([isInTree(table, root, 200), isInTree(table, root, 9360)]).toEqual([true, true]);
  });

  test("leaves out a process beside it", () => {
    expect(isInTree(table, root, 555)).toBe(false);
  });

  test("leaves out a 'child' created before its parent: the parent's pid was reused", () => {
    expect([isInTree(table, root, 700), isInTree(table, root, 800)]).toEqual([false, false]);
  });

  test("leaves out everything when the root's pid now names a later process", () => {
    expect(isInTree(table, { pid: 100, created: 999n }, 9360)).toBe(false);
  });

  test("keeps creation times past 2^53 exact", () => {
    const rows = parseProcessTable("5 4 134062918011234567\n6 5 134062918011234568");

    expect(isInTree(rows, { pid: 5, created: 134062918011234567n }, 6)).toBe(true);
    expect(isInTree(rows, { pid: 5, created: 134062918011234566n }, 6)).toBe(false);
  });

  windowsOnly("this process is in its parent's tree, as Windows reports it now", () => {
    const parent = identityOf(process.ppid);

    expect(parent).not.toBeNull();
    expect(isInTree(processTable(), parent!, process.pid)).toBe(true);
  });
});
