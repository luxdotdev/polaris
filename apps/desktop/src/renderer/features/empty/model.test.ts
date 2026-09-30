import { describe, expect, test } from "bun:test";
import {
  captionPath,
  connectHostCaption,
  hostStageLine,
  noSelectionFact,
  readyLine,
  stageKicker,
} from "./model.ts";

describe("empty-state copy", () => {
  test("a workspace with unselected sessions points at the jump menu", () => {
    expect(noSelectionFact(3, "polaris")).toBe("3 sessions in polaris · K to jump");
  });

  test("kickers name the host, and the workspace when there is one", () => {
    expect(stageKicker("Mac Studio", null)).toBe("Set up · Mac Studio");
    expect(stageKicker("Mac Studio", "polaris")).toBe("polaris · Mac Studio");
  });

  test("the host stage line changes once there are several hosts", () => {
    expect(hostStageLine(1)).toBe(
      "Add a workspace, or start a session in your home folder. Remote hosts can come now or later."
    );
    expect(hostStageLine(3)).toBe(
      "Add a workspace on any of your hosts, or start a session in your home folder."
    );
  });

  test("the connect-a-host caption says what it counts", () => {
    expect(connectHostCaption(14, 0)).toBe("14 hosts in ~/.ssh/config · optional");
    expect(connectHostCaption(0, 1)).toBe("1 other host added · optional");
    expect(connectHostCaption(0, 0)).toBe("Any machine you can reach over SSH · optional");
  });

  test("ready harnesses read as a list", () => {
    expect(readyLine([], "Pi")).toBe("No harness is ready on Pi yet");
    const claude = { name: "Claude Code", version: "2.1.4" };
    const codex = { name: "Codex", version: "0.52.0" };

    expect(readyLine([{ name: "Codex", version: null }], "Pi")).toBe("Codex is ready on Pi");
    expect(readyLine([claude, codex], "Pi")).toBe(
      "Claude Code 2.1.4 and Codex 0.52.0 are ready on Pi"
    );
    expect(readyLine([claude, codex, { name: "OpenCode", version: "1.15.5" }], "Pi")).toBe(
      "Claude Code 2.1.4, Codex 0.52.0, and 1 other are ready on Pi"
    );
  });

  test("glossary words stay lowercase (rule/glossary-lowercase)", () => {
    const copy = [noSelectionFact(1, "x"), noSelectionFact(3, "x"), hostStageLine(1)];

    for (const line of copy) expect(line).not.toMatch(/\b(Workspace|Session|Host)s?\b/);
  });
});

describe("captionPath", () => {
  test("home-relative under home; otherwise the last folders survive, never the start", () => {
    expect(captionPath("/Users/ada/code/polaris", "/Users/ada")).toBe("~/code/polaris");
    expect(captionPath("/srv/app", "/Users/ada")).toBe("/srv/app");
    expect(
      captionPath(
        "/var/folders/rx/45btddts0f19z547h16vy6r40000gn/T/polaris-empty-x/code/polaris",
        null
      )
    ).toBe("…/T/polaris-empty-x/code/polaris");
  });
});
