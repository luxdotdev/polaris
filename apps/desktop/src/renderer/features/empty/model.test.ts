import { describe, expect, test } from "bun:test";
import {
  absolutePath,
  cleanPath,
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
    expect(hostStageLine(1)).toMatch(/^Add a workspace to start your first session/);
    expect(hostStageLine(3)).toBe("Add a workspace on any of your hosts to start a session");
  });

  test("ready harnesses read as a list", () => {
    expect(readyLine([], "Pi")).toBe("No harness is ready on Pi yet");
    expect(readyLine(["Codex"], "Pi")).toBe("Codex is ready on Pi");
    expect(readyLine(["Claude Code", "Codex"], "Pi")).toBe("Claude Code and Codex are ready on Pi");
    expect(readyLine(["Claude Code", "Codex", "OpenCode"], "Pi")).toBe(
      "Claude Code, Codex and 1 other are ready on Pi"
    );
  });

  test("glossary words stay lowercase (rule/glossary-lowercase)", () => {
    const copy = [noSelectionFact(1, "x"), noSelectionFact(3, "x"), hostStageLine(1)];

    for (const line of copy) expect(line).not.toMatch(/\b(Workspace|Session|Host)s?\b/);
  });
});

describe("workspace paths", () => {
  test("typed paths are absolute or home-relative", () => {
    expect(cleanPath("  ~/code/polaris/ ")).toBe("~/code/polaris");
    expect(cleanPath("/srv/app")).toBe("/srv/app");
    expect(cleanPath("~")).toBe("~");
    expect(cleanPath("/")).toBe("/");
    expect(cleanPath("code/polaris")).toBeNull();
    expect(cleanPath("")).toBeNull();
  });

  test("home-relative paths expand on the Host's home", () => {
    expect(absolutePath("~/code", "/Users/me")).toBe("/Users/me/code");
    expect(absolutePath("~", "/home/pi")).toBe("/home/pi");
    expect(absolutePath("/srv", null)).toBe("/srv");
    expect(absolutePath("~/code", null)).toBeNull();
  });
});
