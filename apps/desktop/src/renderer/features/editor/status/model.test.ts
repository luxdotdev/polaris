import { describe, expect, test } from "bun:test";
import { statusView } from "./model.ts";
import {
  downloading,
  file,
  input,
  missingPython,
  running,
  runtimes,
  trust,
} from "./fixtures.testing.ts";

const ids = (view: ReturnType<typeof statusView>) => view.actions.map((action) => action.id);

describe("language status pill", () => {
  test("ready with the project's TypeScript: a filled mark and just the language", () => {
    const view = statusView(input({ trust: trust("trusted", "project") }));

    expect(view).toMatchObject({ kind: "ready", mark: "filled", pill: "TypeScript" });
    expect(view.title).toBe("TypeScript is ready");
    expect(view.facts.map((fact) => [fact.label, fact.value, fact.note])).toEqual([
      ["TypeScript", "7.0.2", "from this project"],
      ["Server", "typescript-language-server", "up 14m"],
      ["Host", "Mac Studio", undefined],
      ["Trust", "You trust polaris", undefined],
    ]);
    expect(ids(view)).toEqual(["restart", "use-bundled", "show-log", "settings"]);
    expect(view.actions[1]?.hint).toBe("6.0.3");
  });

  test("bundled because polaris isn't trusted: hollow, and Trust leads the actions", () => {
    const view = statusView(input({ trust: trust("declined", "bundled") }));

    expect(view).toMatchObject({ kind: "bundled", mark: "hollow", pill: "TypeScript · bundled" });
    expect(view.title).toBe("TypeScript is ready, bundled");
    expect(view.why).toContain("You haven't trusted polaris, so its own TypeScript 7.0.2");
    expect(view.facts[0]).toMatchObject({ value: "6.0.3", note: "bundled" });
    expect(view.facts.at(-1)).toMatchObject({ label: "Trust", value: "Not now" });
    expect(ids(view)).toEqual(["trust", "restart", "show-log", "settings"]);
    expect(view.actions[0]?.label).toBe("Trust polaris…");
  });

  test("bundled with no project TypeScript is running as intended", () => {
    const view = statusView(input({ trust: trust("undecided", "bundled", null) }));

    expect(view).toMatchObject({ kind: "ready", mark: "filled", pill: "TypeScript" });
  });

  test("trusted but switched to bundled offers the project's TypeScript back", () => {
    const view = statusView(input({ trust: trust("trusted", "bundled") }));

    expect(view.kind).toBe("bundled");
    expect(view.why).toContain("You chose the bundled TypeScript for polaris");
    expect(ids(view)[0]).toBe("use-project");
  });

  test("setting up while checking, then downloading with progress", () => {
    const checking = statusView(input({ file: file({ phase: "checking" }), runtimes: [] }));

    expect(checking).toMatchObject({
      kind: "setting-up",
      mark: "hollow",
      pill: "TypeScript · setting up",
      title: "Setting up TypeScript",
    });
    expect(checking.why).toBe(
      "Checking language tools on Mac Studio. Highlighting works meanwhile."
    );

    const view = statusView(
      input({ file: file({ phase: "checking" }), runtimes: [], tools: downloading })
    );

    expect(view.why).toBe("Downloading its Node to Mac Studio. Highlighting works meanwhile.");
    expect(view.progress).toEqual({
      tool: "node 24.18.0",
      fraction: 18 / 46,
      amount: "18 of 46 MB",
    });
  });

  test("a starting server is still setting up and links its log", () => {
    const view = statusView(input({ runtimes: [running(runtimes.starting)] }));

    expect(view.kind).toBe("setting-up");
    expect(ids(view)).toEqual(["show-log"]);
  });

  test("a missing Prerequisite shows the command for its Host and Check again", () => {
    const view = statusView(
      input({
        language: "Python",
        file: file({ providers: [missingPython], contexts: {} }),
        runtimes: [],
        host: "Raspberry Pi 4",
        hostInSentence: "Raspberry Pi 4",
      })
    );

    expect(view).toMatchObject({
      kind: "prerequisite",
      mark: "hollow",
      pill: "Python · needs Python",
      title: "Python needs an interpreter",
      command: "uv python install",
      commandHost: "Raspberry Pi 4",
    });
    expect(view.why).toContain("Polaris doesn't install toolchains.");
    expect(ids(view)).toEqual(["check-again", "settings"]);
  });

  test("three crashes: the failed mark, stderr and Restart then Show log", () => {
    const view = statusView(input({ runtimes: [running(runtimes.crashed())] }));

    expect(view).toMatchObject({
      kind: "crashed",
      mark: "failed",
      tone: "failed",
      pill: "TypeScript · stopped",
      title: "TypeScript stopped",
      stderr: "FATAL ERROR: Reached heap limit\nAllocation failed",
    });
    expect(view.why).toContain("crashed 3 times in 2 minutes");
    expect(ids(view)).toEqual(["restart", "show-log"]);
    expect(view.actions[0]?.label).toBe("Restart TypeScript server");
  });

  test("a crash with empty stderr says so instead of pointing at the log", () => {
    const view = statusView(input({ runtimes: [running(runtimes.crashed(""))] }));

    expect(view.stderr).toBeNull();
    expect(view.why).toContain("It wrote nothing to stderr.");
  });

  test("an idle stop is hollow, never the failed hue", () => {
    const view = statusView(input({ runtimes: [running(runtimes.idle)] }));

    expect(view).toMatchObject({ kind: "stopped", mark: "hollow", pill: "TypeScript · stopped" });
  });

  test("a crashing server between restarts reads restarting", () => {
    const view = statusView(input({ runtimes: [running(runtimes.failed)] }));

    expect(view).toMatchObject({ kind: "restarting", pill: "TypeScript · restarting" });
  });

  test("awaiting Trust asks for it", () => {
    const view = statusView(input({ runtimes: [running(runtimes.awaitingTrust)] }));

    expect(view).toMatchObject({ kind: "trust", pill: "TypeScript · needs Trust" });
    expect(ids(view)).toEqual(["trust", "show-log"]);
  });

  test("downloads turned off read not downloaded, with the setting", () => {
    const view = statusView(
      input({
        file: file({
          phase: "failed",
          failure: { reason: "not-installed", message: "off" },
          contexts: {},
        }),
        runtimes: [],
      })
    );

    expect(view).toMatchObject({ pill: "TypeScript · not downloaded", mark: "hollow" });
    expect(ids(view)).toEqual(["settings"]);
  });

  test("a Host without language tooling, or a language without a server, is syntax only", () => {
    const local = statusView(input({ file: file({ phase: "local" }), runtimes: [] }));

    expect(local).toMatchObject({ kind: "syntax", mark: "none", pill: "TypeScript" });

    const none = statusView(
      input({ language: "Go", file: file({ providers: [], contexts: {} }), runtimes: [] })
    );

    expect(none.why).toBe("Highlighting works. Go has no language server yet.");
  });

  test("an eligible provider not yet acquired is setting up", () => {
    const view = statusView(input({ file: file({ contexts: {} }), runtimes: [] }));

    expect(view.kind).toBe("setting-up");
  });
});
