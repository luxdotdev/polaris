import { describe, expect, test } from "bun:test";
import {
  changesLabel,
  checkedReplacements,
  hunksOf,
  rangeLabel,
  statsOf,
  thoughtLabel,
} from "./patch.ts";

const doc = ["for (;;) {", "  try {", "    await sleep(BASE);", "  }", "}"].join("\n");

const at = (s: string) => doc.indexOf(s);

describe("checkedReplacements", () => {
  test("sorts them", () => {
    const patch = {
      summary: "",
      replacements: [
        { from: 5, to: 6, text: "b" },
        { from: 0, to: 1, text: "a" },
      ],
    };

    expect(checkedReplacements(patch, doc.length)?.map((r) => r.text)).toEqual(["a", "b"]);
  });

  test("refuses overlap and out of range", () => {
    expect(
      checkedReplacements(
        {
          summary: "",
          replacements: [
            { from: 0, to: 5, text: "" },
            { from: 4, to: 6, text: "" },
          ],
        },
        doc.length
      )
    ).toBeNull();
    expect(
      checkedReplacements(
        { summary: "", replacements: [{ from: 0, to: doc.length + 1, text: "" }] },
        doc.length
      )
    ).toBeNull();
  });
});

describe("hunksOf", () => {
  test("one line becomes two: −1 +2 on that line", () => {
    const from = at("    await");
    const to = at("\n  }");
    const text = "    const backoff = 2 ** attempt;\n    await sleep(backoff);";
    const hunks = hunksOf(doc, [{ from, to, text }]);

    expect(hunks).toEqual([
      {
        line: 3,
        removed: ["    await sleep(BASE);"],
        added: ["    const backoff = 2 ** attempt;", "    await sleep(backoff);"],
      },
    ]);
    expect(statsOf(hunks)).toEqual({ changes: 1, added: 2, removed: 1 });
  });

  test("a replacement spanning unchanged lines keeps only the changed ones", () => {
    const from = at("  try");
    const to = at("\n}");
    const text = "  try {\n    await sleep(2);\n  }";

    expect(hunksOf(doc, [{ from, to, text }])).toEqual([
      { line: 3, removed: ["    await sleep(BASE);"], added: ["    await sleep(2);"] },
    ]);
  });

  test("a pure insertion follows the line above it", () => {
    const pos = at("  }");

    expect(hunksOf(doc, [{ from: pos, to: pos, text: "    log();\n" }])).toEqual([
      { line: 3, removed: [], added: ["    log();"] },
    ]);
  });

  test("a no-op replacement is no change", () => {
    expect(hunksOf(doc, [{ from: 0, to: 3, text: "for" }])).toEqual([]);
  });
});

describe("labels", () => {
  test("thought", () => {
    expect(thoughtLabel(300)).toBe("Thought for 1s");
    expect(thoughtLabel(4200)).toBe("Thought for 4s");
    expect(thoughtLabel(65_000)).toBe("Thought for 1m 5s");
    expect(thoughtLabel(120_000)).toBe("Thought for 2m");
  });

  test("changes and range", () => {
    expect(changesLabel(1)).toBe("1 change");
    expect(changesLabel(3)).toBe("3 changes");
    expect(rangeLabel(10, 19)).toBe("lines 10–19");
    expect(rangeLabel(4, 4)).toBe("line 4");
  });
});
