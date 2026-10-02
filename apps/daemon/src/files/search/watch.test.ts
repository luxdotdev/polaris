import { afterEach, expect, test } from "bun:test";
import { watch } from "node:fs";
import { join } from "node:path";
import { makeRepo, removeDir, tempDir, write } from "../../git/testing.ts";
import { WATCH_MAX_DIRECTORIES, watchRoot } from "./watch.ts";

const roots: Array<string> = [];

const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();

  for (const root of roots.splice(0)) removeDir(root);
});

const recorder = () => {
  const opened: Array<{ path: string; recursive: boolean }> = [];

  const open: NonNullable<NonNullable<Parameters<typeof watchRoot>[2]>["open"]> = (
    path,
    recursive,
    changed
  ) => {
    opened.push({ path, recursive });

    return watch(path, { recursive: false }, (event, name) => {
      if (name !== null) changed(event, join(path, name.toString()));
    });
  };

  return { opened, open };
};

test("a large non-git Workspace never registers a native tree watch on Linux", async () => {
  const root = tempDir("polaris-home-watch-");
  roots.push(root);

  for (let i = 0; i < WATCH_MAX_DIRECTORIES + 100; i++) {
    write(root, `.cache/uv/archive-v0/${i}/lib/python3.11/site-packages/cachetools/a.py`, "pass");
  }

  const { opened, open } = recorder();
  const stop = await watchRoot(root, () => undefined, { platform: "linux", open });
  stops.push(stop);
  expect(opened).toEqual([]);
});

test("git watches are capped and never ask the runtime to recurse", async () => {
  const root = await makeRepo();
  roots.push(root);

  for (let i = 0; i < WATCH_MAX_DIRECTORIES + 10; i++) write(root, `src/${i}/a.ts`, "");
  const { opened, open } = recorder();
  stops.push(await watchRoot(root, () => undefined, { platform: "linux", open }));
  expect(opened).toHaveLength(WATCH_MAX_DIRECTORIES);
  expect(opened.every((entry) => !entry.recursive)).toBe(true);
}, 20_000);

test("a huge flat git directory is not handed to Bun's native enumerator", async () => {
  const root = await makeRepo();
  roots.push(root);

  for (let i = 0; i < 4100; i++) write(root, `file-${i}`, "");
  const { opened, open } = recorder();
  stops.push(await watchRoot(root, () => undefined, { platform: "linux", open }));
  expect(opened).toEqual([]);
});

test("git watches skip ignored directories, metadata and node_modules", async () => {
  const root = await makeRepo({ ".gitignore": "build/\n", "src/nested/a.ts": "" });
  roots.push(root);
  write(root, "build/deep/a.js", "");
  write(root, "node_modules/deep/a.js", "");
  const { opened, open } = recorder();
  stops.push(await watchRoot(root, () => undefined, { platform: "linux", open }));
  expect(opened.map((entry) => entry.path).sort()).toEqual(
    [root, join(root, "src"), join(root, "src/nested")].sort()
  );
});

test("bounded git watches report nested changes and discover new directories", async () => {
  const root = await makeRepo({ "src/a.ts": "" });
  roots.push(root);
  const seen: Array<string> = [];
  const { opened, open } = recorder();

  const stop = await watchRoot(root, (_event, path) => seen.push(path), {
    platform: "linux",
    open,
  });

  stops.push(stop);
  await Bun.sleep(300);
  write(root, "src/a.ts", "changed");
  await waitFor(() => seen.includes(join(root, "src/a.ts")));
  write(root, "src/new/nested/a.ts", "new");
  await waitFor(() => opened.some((entry) => entry.path === join(root, "src/new/nested")));
  write(root, "src/new/nested/a.ts", "changed");
  await waitFor(() => seen.includes(join(root, "src/new/nested/a.ts")));
  stop();
  const count = opened.length;
  write(root, "src/after/a.ts", "");
  await Bun.sleep(100);
  expect(opened).toHaveLength(count);
});

test("macOS keeps its single native recursive FSEvents watch", async () => {
  const root = tempDir("polaris-mac-watch-");
  roots.push(root);
  const { opened, open } = recorder();
  stops.push(await watchRoot(root, () => undefined, { platform: "darwin", open }));
  expect(opened).toEqual([{ path: root, recursive: true }]);
});

const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Bun.sleep(20);
  }

  throw new Error("watch notification missing");
};
