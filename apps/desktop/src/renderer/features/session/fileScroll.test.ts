import "../../test/dom.testing.ts";
import { describe, expect, test } from "bun:test";
import { createFileScroll, maxOffset, sidewaysDelta, thumbPlace } from "./fileScroll.ts";

/** A 400px lane of 8px cells: 302px of code shows, so 36 cells fit with the end room. */
const GEOMETRY = { lane: 400, cell: 8 };

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const span = () => document.createElement("span");

const setUp = () => {
  const scroll = createFileScroll();

  scroll.measure(
    new Map([
      ["wide.ts", 100],
      ["also-wide.ts", 60],
      ["short.ts", 10],
    ]),
    GEOMETRY
  );

  return scroll;
};

describe("createFileScroll", () => {
  test("scrolling one file moves only that file's code", async () => {
    const scroll = setUp();
    const wide = span();
    const other = span();

    scroll.code("wide.ts", wide);
    scroll.code("also-wide.ts", other);
    scroll.scrollBy("wide.ts", 50);
    await frame();

    expect(wide.style.transform).toBe("translateX(-50px)");
    expect(other.style.transform).toBe("");
  });

  test("a row that remounts takes its file's offset", async () => {
    const scroll = setUp();
    const first = span();
    const unmount = scroll.code("wide.ts", first);

    scroll.scrollBy("wide.ts", 120);
    await frame();
    unmount();

    const again = span();

    scroll.code("wide.ts", again);
    expect(again.style.transform).toBe("translateX(-120px)");
  });

  test("an offset stops at the file's last character, and a file that fits never moves", async () => {
    const scroll = setUp();
    const wide = span();
    const short = span();

    scroll.code("wide.ts", wide);
    scroll.code("short.ts", short);
    scroll.scrollBy("wide.ts", 10_000);
    scroll.scrollBy("short.ts", 50);
    await frame();

    expect(wide.style.transform).toBe(`translateX(-${100 * 8 + 12 - 302}px)`);
    expect(short.style.transform).toBe("");
  });

  test("a wider lane pulls a scrolled file back to its new end", () => {
    const scroll = setUp();

    scroll.scrollBy("wide.ts", 10_000);
    scroll.measure(new Map([["wide.ts", 100]]), { lane: 800, cell: 8 });

    expect(scroll.offset("wide.ts")).toBe(100 * 8 + 12 - 702);
  });

  test("tells its subscribers only when the set of overflowing files changes", () => {
    const scroll = setUp();

    const columns = new Map([
      ["wide.ts", 100],
      ["also-wide.ts", 60],
      ["short.ts", 10],
    ]);

    let told = 0;

    scroll.subscribe(() => told++);
    scroll.measure(columns, { lane: 410, cell: 8 });
    expect(told).toBe(0);
    scroll.measure(columns, { lane: 600, cell: 8 });

    expect(told).toBe(1);
    expect([...scroll.overflowing()]).toEqual(["wide.ts"]);
  });
});

describe("thumbPlace", () => {
  test("at the end, the thumb's right edge meets the track's", () => {
    const { width, left } = thumbPlace(300, 300, 500, 500);

    expect(left + width).toBe(300);
  });

  test("a very wide file keeps a thumb big enough to grab", () => {
    expect(thumbPlace(300, 300, 1_000_000, 0).width).toBe(24);
  });
});

describe("maxOffset", () => {
  test("is zero when the widest line fits with its end room", () => {
    expect(maxOffset(36, GEOMETRY)).toBe(0);
    expect(maxOffset(37, GEOMETRY)).toBe(6);
  });
});

describe("sidewaysDelta", () => {
  test.each([
    ["a sideways trackpad swipe", { deltaX: 30, deltaY: 4, shiftKey: false }, 30],
    ["a mostly vertical swipe scrolls the list", { deltaX: 4, deltaY: 30, shiftKey: false }, null],
    ["shift and a mouse wheel scroll sideways", { deltaX: 0, deltaY: 40, shiftKey: true }, 40],
  ])("%s", (_name, event, delta) => {
    expect(sidewaysDelta(event)).toBe(delta);
  });
});
