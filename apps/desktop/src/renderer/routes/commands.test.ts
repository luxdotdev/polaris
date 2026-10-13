import { describe, expect, test } from "bun:test";
import type { ContextKey } from "../../shared/keymap.ts";
import { type ContextPart, createCommandRegistry, type FollowUp } from "./commands.ts";

const key = (code: string, mods: Partial<Record<"meta" | "alt" | "shift", boolean>> = {}) => ({
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  typing: false,
});

const withKeys =
  (...keys: ReadonlyArray<ContextKey>) =>
  (): ContextPart => ({ keys });

describe("availability", () => {
  test("a command runs only when its when-condition holds and its handler is enabled", () => {
    const registry = createCommandRegistry({ platform: "mac" });
    let restarts = 0;

    registry.register({ "language.restart": { run: () => restarts++ } });

    expect(registry.enabled("language.restart")).toBe(false);
    expect(registry.handleKey(key("KeyR", { meta: true, alt: true }))).toBe(false);

    const remove = registry.provide(withKeys("editor.file", "language.server"));

    expect(registry.handleKey(key("KeyR", { meta: true, alt: true }))).toBe(true);
    expect(restarts).toBe(1);

    remove();
    expect(registry.run("language.restart")).toBe(false);
    expect(restarts).toBe(1);
  });

  test("the handler's own enabled still gates a command whose condition holds", () => {
    const registry = createCommandRegistry({ platform: "mac" });

    registry.provide(withKeys("editor.file", "trust.known", "trust.trusted"));
    registry.register({ "trust.revoke": { run: () => undefined, enabled: () => false } });

    expect(registry.enabled("trust.revoke")).toBe(false);
  });

  test("context parts from several features merge", () => {
    const registry = createCommandRegistry({ platform: "mac" });

    registry.provide(() => ({ keys: ["workspace"], values: { workspace: "polaris" } }));
    registry.provide(() => ({ keys: ["editor.file"], values: { language: "TypeScript" } }));

    const { keys, values } = registry.context();

    expect([...keys].toSorted()).toEqual(["editor.file", "workspace"]);
    expect(values).toEqual({ workspace: "polaris", language: "TypeScript" });
  });
});

describe("the palette's rows", () => {
  test("titles fill from the context; a title missing its word is left out", () => {
    const registry = createCommandRegistry({ platform: "mac" });

    registry.register({
      "session.new": { run: () => undefined },
      "language.restart": { run: () => undefined },
      "palette.open": { run: () => undefined },
    });
    registry.provide(withKeys("editor.file", "language.server"));

    expect(registry.palette().map((r) => r.id)).toEqual([]);

    registry.provide(() => ({ values: { workspace: "polaris", language: "TypeScript" } }));
    const rows = registry.palette();

    expect(rows.map((r) => [r.title, r.group, r.shortcut])).toEqual([
      ["Restart TypeScript server", "file", "⌥⌘R"],
      ["New session in polaris", "workspace", "⌘N"],
    ]);
    expect(rows.find((r) => r.id === "language.restart")?.ariaKeys).toBe("Meta+Alt+R");
  });

  test("a disabled handler hides its row", () => {
    const registry = createCommandRegistry({ platform: "mac" });

    registry.register({ "updates.restart": { run: () => undefined, enabled: () => false } });

    expect(registry.palette()).toEqual([]);
  });
});

describe("contributions", () => {
  test("a feature's command is listed, runs by id, and goes when removed", () => {
    const registry = createCommandRegistry({ platform: "mac" });
    let ran = 0;

    const remove = registry.contribute([
      {
        id: "fun.stars",
        title: "Count the stars",
        palette: { group: "app", searchOnly: true },
        handler: { run: () => ran++ },
      },
    ]);

    expect(registry.palette()).toMatchObject([{ id: "fun.stars", searchOnly: true }]);
    expect(registry.runAny("fun.stars")).toBe(true);
    expect(ran).toBe(1);

    remove();
    expect(registry.palette()).toEqual([]);
    expect(registry.runAny("fun.stars")).toBe(false);
  });

  test("a contribution can't take a keymap id", () => {
    const registry = createCommandRegistry({ platform: "mac" });

    registry.contribute([
      {
        id: "theme.toggle",
        title: "Not the real toggle",
        palette: { group: "app" },
        handler: { run: () => undefined },
      },
    ]);

    expect(registry.palette()).toEqual([]);
  });

  test("a contribution's when-condition gates it", () => {
    const registry = createCommandRegistry({ platform: "mac" });

    registry.contribute([
      {
        id: "editor.wordCount",
        title: "Count words",
        palette: { group: "file" },
        when: "editor.file",
        handler: { run: () => undefined },
      },
    ]);

    expect(registry.runAny("editor.wordCount")).toBe(false);
    registry.provide(withKeys("editor.file"));
    expect(registry.runAny("editor.wordCount")).toBe(true);
  });
});

describe("follow-ups", () => {
  test("a '…' command hands its question to the palette instead of running", () => {
    const registry = createCommandRegistry({ platform: "mac" });
    const asked: Array<FollowUp> = [];

    const question: FollowUp = {
      title: "Select TypeScript version",
      choices: [{ id: "use-bundled", title: "Use the bundled TypeScript", run: () => undefined }],
    };

    registry.provide(withKeys("editor.file", "trust.known", "language.typescript"));
    registry.register({ "typescript.selectVersion": { followUp: () => question } });
    registry.onFollowUp((f) => asked.push(f));

    expect(registry.run("typescript.selectVersion")).toBe(true);
    expect(asked).toEqual([question]);
    expect(registry.palette()[0]).toMatchObject({ followUp: true });
  });
});

describe("Control+Tab by mode", () => {
  const press = (
    code: string,
    mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>>
  ) => ({
    code,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    typing: false,
  });

  for (const platform of ["mac", "windows", "linux"] as const)
    test(`on ${platform} Edit cycles editor tabs, everywhere else sessions`, () => {
      const registry = createCommandRegistry({ platform });
      const calls: Array<string> = [];
      let edit = false;

      registry.provide(() => ({ keys: edit ? ["mode.edit"] : [] }));
      registry.register({
        "session.next": { run: () => void calls.push("session.next") },
        "session.previous": { run: () => void calls.push("session.previous") },
        "editor.nextTab": { run: () => void calls.push("editor.nextTab") },
        "editor.previousTab": { run: () => void calls.push("editor.previousTab") },
      });

      registry.handleKey(press("Tab", { ctrl: true }));
      registry.handleKey(press("Tab", { ctrl: true, shift: true }));
      edit = true;
      registry.handleKey(press("Tab", { ctrl: true }));
      registry.handleKey(press("Tab", { ctrl: true, shift: true }));
      registry.handleKey(
        platform === "mac"
          ? press("ArrowDown", { meta: true, alt: true })
          : press("PageDown", { ctrl: true })
      );

      expect(calls).toEqual([
        "session.next",
        "session.previous",
        "editor.nextTab",
        "editor.previousTab",
        "session.next",
      ]);
    });

  test("the palette shows both session chords", () => {
    const registry = createCommandRegistry({ platform: "windows" });

    registry.register({ "session.next": { run: () => undefined } });

    const row = registry.palette().find((r) => r.id === "session.next");

    expect([row?.shortcut, row?.ariaKeys]).toEqual([
      "Ctrl+Page Down / Ctrl+Tab",
      "Control+PageDown Control+Tab",
    ]);
  });
});
