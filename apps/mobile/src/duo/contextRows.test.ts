import { describe, expect, test } from "bun:test";
import { RiskFindingId } from "@polaris/protocol";
import { parsePatch } from "../review/patch.ts";
import { finding } from "../thread/daemon.testing.ts";
import { contextRows, type TurnFiles } from "./contextRows.ts";

const patch = [
  "diff --git a/index.html b/index.html",
  "index 3333333..4444444 100644",
  "--- a/index.html",
  "+++ b/index.html",
  "@@ -1,2 +1,2 @@",
  "-<title>Old</title>",
  "+<title>New</title>",
  " <body>",
  "",
].join("\n");

const ready: TurnFiles = {
  kind: "ready",
  files: parsePatch(patch).map((diff) => ({ diff, added: 1, removed: 1 })),
  summary: null,
};

const critical = finding({ path: "serve.ts" });

const elsewhere = finding({ id: RiskFindingId.make("f-2"), path: "index.html", severity: "high" });

const cards = (files: TurnFiles) =>
  contextRows(files, [critical, elsewhere], "serve.ts").flatMap((row) =>
    row.kind === "finding" ? [row.finding.id] : []
  );

const notes = (files: TurnFiles) =>
  contextRows(files, [critical], "serve.ts").flatMap((row) =>
    row.kind === "note" ? [row.text] : []
  );

describe("the context pane never hides the focused file's Critical card", () => {
  test.each([
    ["the file has left the diff", ready, "This file has no changes left in this turn's diff."],
    [
      "the diff failed",
      { kind: "failed", message: "git diff failed", summary: null },
      "git diff failed",
    ],
    ["the diff is loading", { kind: "loading" }, "Loading the diff…"],
  ] as const)("when %s, the card shows under the reason", (_, files, reason) => {
    expect(cards(files)).toEqual([critical.id]);
    expect(notes(files)[0]).toBe(reason);
  });

  test("with the file in the diff, only its own findings show", () => {
    expect(
      contextRows(ready, [critical, elsewhere], "index.html").flatMap((row) =>
        row.kind === "finding" ? [row.finding.id] : []
      )
    ).toEqual([elsewhere.id]);
  });
});
