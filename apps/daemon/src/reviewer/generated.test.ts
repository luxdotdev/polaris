import { afterEach, describe, expect, test } from "bun:test";
import { commitAll, makeRepo, removeDir, write } from "../git/testing.ts";
import { generatedAmong, generatedPaths, mayHaveAttributes, parseCheckAttr } from "./generated.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

describe("generated files", () => {
  test("check-attr output: linguist-generated decides, -diff counts, =false rescues", () => {
    const output = [
      ["a.ts", "linguist-generated", "set"],
      ["a.ts", "diff", "unspecified"],
      ["b.bin", "linguist-generated", "unspecified"],
      ["b.bin", "diff", "unset"],
      ["bun.lock", "linguist-generated", "false"],
      ["bun.lock", "diff", "unset"],
      ["c.ts", "linguist-generated", "unspecified"],
      ["c.ts", "diff", "unspecified"],
    ]
      .flat()
      .join("\0");

    expect([...parseCheckAttr(`${output}\0`)]).toEqual([
      ["a.ts", true],
      ["b.bin", true],
      ["bun.lock", false],
    ]);
  });

  test("built-in patterns, attributes and ignore globs together", () => {
    const generated = generatedAmong({
      paths: ["bun.lock", "yarn.lock", "src/a.ts", "src/schema.ts", "docs/x.md"],
      attributes: new Map([
        ["yarn.lock", false],
        ["src/schema.ts", true],
      ]),
      ignore: ["docs/**"],
    });

    expect([...generated]).toEqual(["bun.lock", "src/schema.ts", "docs/x.md"]);
  });

  test("reads .gitattributes and .polaris/review.md at the head", async () => {
    const root = await makeRepo({ "README.md": "hi\n" });
    cleanup.push(root);
    write(root, ".gitattributes", "api/** linguist-generated\nassets/*.svg -diff\n");
    write(root, ".polaris/review.md", "---\nignore:\n  - fixtures/**\n---\nBe kind.\n");
    const head = await commitAll(root, "attributes");
    // The working tree moving on doesn't change what the head says.
    write(root, ".gitattributes", "");

    const generated = await generatedPaths({
      root,
      head,
      repo: root,
      paths: ["api/client.ts", "assets/logo.svg", "fixtures/a.json", "src/a.ts", "go.sum"],
    });

    expect([...generated].sort()).toEqual([
      "api/client.ts",
      "assets/logo.svg",
      "fixtures/a.json",
      "go.sum",
    ]);
  });

  test("a working tree's nested .gitattributes counts; none means git isn't asked", async () => {
    const root = await makeRepo({ "README.md": "hi\n" });
    cleanup.push(root);

    expect(await mayHaveAttributes(root, ["web/src/a.ts"])).toBe(false);

    write(root, "web/.gitattributes", "src/gen/** linguist-generated\n");
    write(root, ".polaris/review.md", "---\nignore:\n  - notes/**\n---\n");

    expect(await mayHaveAttributes(root, ["web/src/a.ts"])).toBe(true);
    expect(await mayHaveAttributes(root, ["api/a.ts"])).toBe(false);

    const generated = await generatedPaths({
      root,
      head: null,
      repo: root,
      paths: ["web/src/gen/a.ts", "web/src/b.ts", "notes/x.md"],
    });

    expect([...generated].sort()).toEqual(["notes/x.md", "web/src/gen/a.ts"]);
  });
});
