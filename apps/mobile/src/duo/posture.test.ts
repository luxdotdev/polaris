import { describe, expect, test } from "bun:test";
import { devReport, type HingeReport, postureOf, readReport } from "./posture.ts";

// The Duo's inner display, landscape (D6) and turned to portrait over a tabletop fold (D7, D8).
const wide = { width: 951, height: 669 };

const tall = { width: 669, height: 951 };

const verticalFold = { x: 455.5, y: 0, width: 40, height: 669 };

const horizontalFold = { x: 0, y: 455.5, width: 669, height: 40 };

const report = (
  status: NonNullable<HingeReport["hinge"]>["status"] | null,
  size: { readonly width: number; readonly height: number },
  divisions: HingeReport["divisions"]
): HingeReport => ({
  hinge: status === null ? null : { status, angle: 120 },
  ...size,
  divisions,
});

describe("postureOf", () => {
  test.each([
    ["no Duo", report(null, wide, [verticalFold])],
    ["a closed hinge", report("closed", wide, [verticalFold])],
    ["an unknown hinge", report("unknown", wide, [verticalFold])],
    ["no division on the cover display", report("fullyOpen", { width: 402, height: 874 }, [])],
  ])("%s keeps the iPhone app", (_, input) => {
    expect(postureOf(input)).toEqual({ kind: "folded" });
  });

  test("fully open, the halves sit either side of the 40pt division", () => {
    expect(postureOf(report("fullyOpen", wide, [verticalFold]))).toEqual({
      kind: "unfolded",
      first: { x: 0, y: 0, width: 455.5, height: 669 },
      second: { x: 495.5, y: 0, width: 455.5, height: 669 },
      division: verticalFold,
    });
  });

  test("half-folded over a horizontal fold is the laptop and monitor's top and bottom", () => {
    expect(postureOf(report("partiallyOpen", tall, [horizontalFold]))).toEqual({
      kind: "halfFolded",
      top: { x: 0, y: 0, width: 669, height: 455.5 },
      bottom: { x: 0, y: 495.5, width: 669, height: 455.5 },
      division: horizontalFold,
    });
  });

  test("half-folded like a book stays side by side", () => {
    expect(postureOf(report("partiallyOpen", wide, [verticalFold])).kind).toBe("unfolded");
  });

  test("a division at the window's edge leaves no second half, so the app stays folded", () => {
    const edge = { x: 911, y: 0, width: 40, height: 669 };

    expect(postureOf(report("fullyOpen", wide, [edge])).kind).toBe("folded");
  });
});

describe("readReport", () => {
  test("reads the module's JSON report, and refuses anything else", () => {
    const json = JSON.stringify(report("fullyOpen", wide, [verticalFold]));

    expect(readReport(json)?.hinge?.status).toBe("fullyOpen");
    expect(readReport('{"hinge":{"status":"ajar","angle":1}}')).toBeNull();
    expect(readReport("null")).toBeNull();
  });
});

describe("devReport", () => {
  test("unfolded splits the window into two halves side by side", () => {
    expect(postureOf(devReport("unfolded", wide))).toEqual({
      kind: "unfolded",
      first: { x: 0, y: 0, width: 476, height: 669 },
      second: { x: 476, y: 0, width: 475, height: 669 },
      division: { x: 476, y: 0, width: 0, height: 669 },
    });
  });

  test("half-folded splits it into a top and a bottom half", () => {
    expect(postureOf(devReport("halfFolded", tall))).toEqual({
      kind: "halfFolded",
      top: { x: 0, y: 0, width: 669, height: 476 },
      bottom: { x: 0, y: 476, width: 669, height: 475 },
      division: { x: 0, y: 476, width: 669, height: 0 },
    });
  });
});
