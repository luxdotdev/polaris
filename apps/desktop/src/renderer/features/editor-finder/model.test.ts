import { describe, expect, test } from "bun:test";
import { matchingRecent, parseQuery, relativeTo, rowOf, withRecent } from "./model.ts";

describe("parseQuery", () => {
  test("keeps a :line for opening, not for searching", () => {
    expect(parseQuery(" reconnect.ts:28 ")).toEqual({
      text: "reconnect.ts",
      line: 28,
      column: null,
    });
    expect(parseQuery("hosts rec")).toEqual({ text: "hosts rec", line: null, column: null });
  });
});

describe("rowOf", () => {
  test("splits name from folder", () => {
    expect(rowOf("daemon/src/hosts/reconnect.ts")).toEqual({
      path: "daemon/src/hosts/reconnect.ts",
      name: "reconnect.ts",
      folder: "daemon/src/hosts",
    });
    expect(rowOf("./README.md")).toEqual({ path: "README.md", name: "README.md", folder: "" });
  });
});

describe("relativeTo", () => {
  test("strips the root, keeps outside paths", () => {
    expect(relativeTo("/code/polaris", "/code/polaris/a/b.ts")).toBe("a/b.ts");
    expect(relativeTo("/code/polaris/", "/code/polaris/a.ts")).toBe("a.ts");
    expect(relativeTo("/code/polaris", "/code/polaris-old/a.ts")).toBe("/code/polaris-old/a.ts");
  });
});

describe("recent", () => {
  test("most recent first, no repeats, bounded", () => {
    const many = Array.from({ length: 25 }, (_, i) => `f${i}`);

    expect(withRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(withRecent(many, "new")).toHaveLength(20);
  });

  test("matches every word", () => {
    expect(matchingRecent(["src/hosts/reconnect.ts", "src/log.ts"], "hosts rec")).toEqual([
      "src/hosts/reconnect.ts",
    ]);
    expect(matchingRecent(["a", "b"], "")).toEqual(["a", "b"]);
  });
});
