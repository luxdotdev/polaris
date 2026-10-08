import { describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { KEYMAP } from "../../../../shared/keymap.ts";
import { fileContext } from "../commands/model.ts";
import { checkout, input } from "../status/fixtures.testing.ts";
import { statusView } from "../status/model.ts";
import {
  interpreterFact,
  interpreterFollowUp,
  interpreterSummary,
  type Interpreter,
  type Interpreters,
} from "./model.ts";

const UV = "/code/polaris/.venv/bin/python";

const VENV = "/code/polaris/tools/venv/bin/python";

const HOST = "/opt/homebrew/bin/python3";

const list = (patch: Partial<Interpreters> = {}): Interpreters =>
  P.LanguagePythonInterpreters.make({
    checkout,
    revision: 4,
    override: null,
    selected: UV,
    interpreters: [
      { path: UV, source: "uv", version: "3.12.4" },
      { path: VENV, source: "venv", version: "3.11.9" },
      { path: HOST, source: "host" },
    ] satisfies ReadonlyArray<Interpreter>,
    ...patch,
  });

const chosen: Array<[string | null, number]> = [];

const followUp = (interpreters: Interpreters) =>
  interpreterFollowUp(interpreters, "Mac Studio", (path, revision) =>
    chosen.push([path, revision])
  );

const rows = (interpreters: Interpreters) =>
  followUp(interpreters).choices.map((c) => [c.title, c.detail, c.disabled === true]);

describe("Python: Select interpreter…", () => {
  test("lists each interpreter by version and source, marks the one in use, then automatic", () => {
    expect(rows(list())).toEqual([
      ["Python 3.12.4 · uv", "In use · uv · .venv/bin/python", false],
      ["Python 3.11.9 · venv", "venv · tools/venv/bin/python", false],
      ["Python · Host", "Host · /opt/homebrew/bin/python3", false],
      ["Use automatic detection", "In use · uv", false],
    ]);
  });

  test("a choice selects at the revision it was listed at; automatic clears the override", () => {
    chosen.length = 0;
    const choices = followUp(list({ override: HOST, selected: HOST })).choices;

    choices.find((c) => c.title === "Python 3.11.9 · venv")?.run();
    choices.find((c) => c.title === "Use automatic detection")?.run();
    expect(chosen).toEqual([
      [VENV, 4],
      [null, 4],
    ]);
  });

  test("with an override, automatic says what it would use; a chosen path outside detection shows", () => {
    const override = list({
      override: "/usr/local/bin/python3.13",
      selected: "/usr/local/bin/python3.13",
      interpreters: [
        { path: "/usr/local/bin/python3.13", source: "override", version: "3.13" },
        { path: UV, source: "uv", version: "3.12.4" },
      ],
    });

    expect(rows(override)).toEqual([
      ["Python 3.13 · chosen", "In use · chosen · /usr/local/bin/python3.13", false],
      ["Python 3.12.4 · uv", "uv · .venv/bin/python", false],
      ["Use automatic detection", "Would use uv", false],
    ]);
  });

  test("nothing found: a disabled row that says how to get one, and automatic", () => {
    expect(rows(list({ selected: null, interpreters: [] }))).toEqual([
      ["No Python found", "Add a .venv, or install Python on Mac Studio", true],
      ["Use automatic detection", "In use", false],
    ]);
  });

  test("the palette lists it for a Python file whose checkout is known, with what runs now", () => {
    const binding = KEYMAP.find((b) => b.id === "python.selectInterpreter");

    expect(binding?.title).toBe("Python: Select interpreter…");
    expect(binding?.when).toEqual({ all: ["editor.file", "language.python"] });

    const python = {
      path: "/code/polaris/app.py",
      language: "python" as const,
      providers: ["basedpyright"],
      status: null,
      workspace: "polaris",
      canFormat: true,
      canShowLog: false,
      hasCheckout: true,
      pythonInterpreter: interpreterSummary(list()),
    };

    const { keys, values } = fileContext(python);

    expect(keys).toContain("language.python");
    expect(values?.pythonInterpreter).toBe("uv · 3.12.4");
    expect(fileContext({ ...python, hasCheckout: false }).keys).not.toContain("language.python");
    expect(fileContext({ ...python, language: "typescript" }).keys).not.toContain(
      "language.python"
    );
  });
});

describe("the status popover's Interpreter row", () => {
  test("version and source, automatic or chosen; None found; nothing before the list", () => {
    expect(interpreterFact(list())).toEqual({
      label: "Interpreter",
      value: "3.12.4",
      mono: true,
      note: "uv, automatic",
    });
    expect(interpreterFact(list({ override: HOST, selected: HOST }))).toEqual({
      label: "Interpreter",
      value: "/opt/homebrew/bin/python3",
      mono: true,
      note: "Host",
    });
    expect(interpreterFact(list({ selected: null, interpreters: [] }))).toEqual({
      label: "Interpreter",
      value: "None found",
    });
    expect(interpreterFact(null)).toBeNull();
  });

  test("a ready Python file shows it before the server", () => {
    const view = statusView(input({ language: "Python", python: list() }));

    expect(view.facts.map((fact) => fact.label)).toEqual(["Interpreter", "Server", "Host"]);
  });
});
