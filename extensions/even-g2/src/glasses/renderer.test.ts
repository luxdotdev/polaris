import { expect, test } from "bun:test";
import type { Page } from "../model/page.ts";
import { rendererFor, type Surface } from "./renderer.ts";

const text = (content: string, id = 1) => ({
  id,
  name: `t${id}`,
  x: 0,
  y: 0,
  width: 576,
  height: 288,
  capture: id === 1,
  content,
});

const page = (...contents: ReadonlyArray<string>): Page => ({
  texts: contents.map((content, i) => text(content, i + 1)),
  lists: [],
});

const glasses = () => {
  const calls: Array<string> = [];

  const surface: Surface = {
    create: async (p) => (calls.push(`create ${p.texts.map((t) => t.content).join("|")}`), true),
    rebuild: async (p) => (calls.push(`rebuild ${p.texts.map((t) => t.content).join("|")}`), true),
    upgrade: async (t) => (calls.push(`upgrade ${t.id} ${t.content}`), true),
  };

  return { calls, surface };
};

test("a burst of pages inside the delay puts only the last on the glasses", async () => {
  const { calls, surface } = glasses();
  const renderer = rendererFor(surface, 20);

  for (const word of ["L", "Li", "Lis", "List"]) renderer.show(page(word));
  await renderer.settled();

  expect(calls).toEqual(["create List"]);
});

test("changed text updates in place; a changed layout rebuilds", async () => {
  const { calls, surface } = glasses();
  const renderer = rendererFor(surface, 5);

  renderer.show(page("a", "b"));
  await renderer.settled();
  renderer.show(page("a", "c"));
  await renderer.settled();
  renderer.show(page("a"));
  await renderer.settled();

  expect(calls).toEqual(["create a|b", "upgrade 2 c", "rebuild a"]);
});

test("a page the glasses refused is drawn again in full", async () => {
  const { calls, surface } = glasses();
  let accept = false;

  const renderer = rendererFor(
    { ...surface, create: async (p) => (calls.push(`create ${p.texts[0]?.content}`), accept) },
    5
  );

  renderer.show(page("a"));
  await renderer.settled();
  accept = true;
  renderer.show(page("b"));
  await renderer.settled();

  expect(calls).toEqual(["create a", "create b"]);
});

test("refused text is not confirmed as visible and is retried", async () => {
  const { surface } = glasses();
  let visible = "";
  let accepts = false;

  const renderer = rendererFor(
    {
      ...surface,
      create: async (value) => {
        visible = value.texts[0]?.content ?? "";

        return true;
      },
      upgrade: async (value) => {
        if (accepts) visible = value.content;

        return accepts;
      },
    },
    0
  );

  renderer.show(page("old"));
  await renderer.settled();
  renderer.show(page("new"));
  await renderer.settled();
  expect(visible).toBe("old");
  expect(renderer.matches(page("new"))).toBe(false);
  accepts = true;
  renderer.show(page("new"));
  await renderer.settled();
  expect(visible).toBe("new");
  expect(renderer.matches(page("new"))).toBe(true);
});

test("closing drops queued display work and ignores later pages", async () => {
  const { surface, calls } = glasses();
  const renderer = rendererFor(surface, 10);
  renderer.show(page("queued"));
  renderer.close();
  renderer.show(page("after exit"));
  await renderer.settled();
  expect(calls).toEqual([]);
});
