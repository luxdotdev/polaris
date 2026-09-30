import { describe, expect, test } from "bun:test";
import { plainText } from "./terminalText.ts";

describe("plainText", () => {
  test("drops colours, cursor moves and window titles", () => {
    expect(plainText("\u001b]0;claude\u0007\u001b[1;32mOpen\u001b[0m this URL\u001b[2K")).toBe(
      "Open this URL"
    );
  });

  test("keeps lines, and a carriage return starts its line over", () => {
    expect(plainText("one\r\ntwo 10%\rtwo 100%\nthree")).toBe("one\ntwo 100%\nthree");
  });

  test("an escape cut off at the end of a chunk is held back", () => {
    expect(plainText("code: ABCD\u001b[3")).toBe("code: ABCD");
  });
});
