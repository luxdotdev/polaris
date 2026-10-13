import { describe, expect, test } from "bun:test";
import { clientCopy, inSentence } from "./clientCopy.ts";

describe("clientCopy", () => {
  test("macOS names the Mac, Finder and macOS", () => {
    expect(clientCopy("darwin")).toMatchObject({
      machine: "this Mac",
      os: "macOS",
      reveal: "Reveal in Finder",
      showApp: "Show in Finder",
    });
  });

  test("Linux says this computer and Show in folder", () => {
    expect(clientCopy("linux")).toMatchObject({
      machine: "this computer",
      os: "Linux",
      reveal: "Show in folder",
      showApp: "Show in folder",
    });
    expect(clientCopy("freebsd")).toBe(clientCopy("linux"));
  });

  test("Windows names the PC, Explorer and Windows", () => {
    expect(clientCopy("win32")).toMatchObject({
      machine: "this PC",
      os: "Windows",
      reveal: "Show in Explorer",
      showApp: "Show in Explorer",
    });
  });

  test.each(["win32", "linux"])("no %s copy mentions the Mac, Finder or macOS", (platform) => {
    for (const text of Object.values(clientCopy(platform))) {
      expect(text).not.toMatch(/\bMac\b|macOS|Finder/);
    }
  });

  test("the local Host's default name reads lowercase in a sentence; given names stay", () => {
    expect(inSentence("This Mac", clientCopy("darwin"))).toBe("this Mac");
    expect(inSentence("This PC", clientCopy("win32"))).toBe("this PC");
    expect(inSentence("This computer", clientCopy("linux"))).toBe("this computer");
    expect(inSentence("This Mac", clientCopy("linux"))).toBe("This Mac");
    expect(inSentence("Mac Studio", clientCopy("darwin"))).toBe("Mac Studio");
  });
});
