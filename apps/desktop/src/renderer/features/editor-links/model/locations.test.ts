import { describe, expect, test } from "bun:test";
import { findLocations, wholeLocation } from "./locations.ts";

const paths = (text: string) => findLocations(text).map((f) => `${f.path}|${f.line}|${f.column}`);

describe("findLocations", () => {
  test("paths with a folder or a code extension", () => {
    expect(paths("see src/hosts/reconnect.ts:28 and log.ts:3:14.")).toEqual([
      "src/hosts/reconnect.ts|28|null",
      "log.ts|3|14",
    ]);
    expect(paths("in /code/polaris/apps/x.tsx:12, then ./y.py:1")).toEqual([
      "/code/polaris/apps/x.tsx|12|null",
      "./y.py|1|null",
    ]);
  });

  test("hosts, ports, times and URLs stay text", () => {
    expect(paths("localhost:3000 example.com:443 at 10:30 https://a.dev/x.ts:4")).toEqual([]);
  });

  test("offsets cover the match", () => {
    const [found] = findLocations("open a/b.ts:9 now");

    expect(found).toMatchObject({ start: 5, end: 13 });
  });
});

describe("wholeLocation", () => {
  test("only when the text is exactly one location", () => {
    expect(wholeLocation("src/a.ts:4")?.line).toBe(4);
    expect(wholeLocation("src/a.ts:4 and more")).toBeNull();
    expect(wholeLocation("const x = 1")).toBeNull();
  });
});
