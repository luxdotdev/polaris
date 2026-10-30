import { describe, expect, test } from "bun:test";
import { BrowserPickResult } from "../../../shared/browserContract.ts";
import { pickNote, pickStem } from "./pick.ts";

const pick = (html: string) =>
  BrowserPickResult.make({
    url: "http://localhost:3000/todos",
    title: "Todos",
    selector: "#todos > li.item:nth-of-type(2)",
    html,
    screenshot: new Uint8Array(),
  });

describe("a picked element's files", () => {
  test.each([
    ["#todos > li.item:nth-of-type(2)", "element-todos-li-item"],
    ['button[data-testid="save"]', "element-button"],
    ["#\\31 23", "element-31-23"],
    ["::", "element"],
  ])("%s is named %s", (selector, stem) => {
    expect(pickStem(selector)).toBe(stem);
  });

  test("the note names the page, the selector and the staged screenshot", () => {
    const note = pickNote(pick("<li>b</li>"), "/home/me/.polaris/staging/s1/a1/shot.png");

    expect(note).toContain("- URL: http://localhost:3000/todos");
    expect(note).toContain("- CSS selector: `#todos > li.item:nth-of-type(2)`");
    expect(note).toContain("- Screenshot: /home/me/.polaris/staging/s1/a1/shot.png");
    expect(note).toContain("```html\n<li>b</li>\n```");
  });

  test("HTML holding a fence can't close the note's fence early", () => {
    const note = pickNote(pick("<pre>```js\nx\n```</pre>"), null);
    const fences = note.split("\n").filter((line) => line.startsWith("````"));

    expect(fences).toEqual(["````html", "````"]);
    expect(note).toContain("<pre>```js\nx\n```</pre>");
  });
});
