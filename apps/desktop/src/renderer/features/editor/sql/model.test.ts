import { describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { KEYMAP } from "../../../../shared/keymap.ts";
import { fileContext } from "../commands/model.ts";
import { checkout, file, input, installedTools } from "../status/fixtures.testing.ts";
import type { Discovered } from "../status/store.ts";
import { statusView } from "../status/model.ts";
import { dialectFact, dialectFollowUp, dialectSummary, type DialectState } from "./model.ts";

const state = (patch: Partial<DialectState> = {}): DialectState =>
  P.LanguageSqlDialectState.make({
    checkout,
    path: "/code/polaris/db/schema.sql",
    revision: 7,
    dialect: "postgresql",
    source: "prisma",
    fileOverride: null,
    workspaceOverride: null,
    ...patch,
  });

const chosen: Array<[string | null, number]> = [];

const rows = (s: DialectState) =>
  dialectFollowUp(s, "polaris", (dialect, revision) =>
    chosen.push([dialect, revision])
  ).choices.map((c) => [c.title, c.detail]);

describe("SQL: Select dialect…", () => {
  test("the four dialects, the one in use marked with where it came from, then automatic", () => {
    expect(rows(state())).toEqual([
      ["PostgreSQL", "In use · from Prisma's datasource"],
      ["MySQL", "Completion and diagnostics"],
      ["SQLite", "Completion and diagnostics"],
      ["Generic SQL", "Formatting only"],
      ["Use automatic detection", "In use"],
    ]);
  });

  test("each source reads plainly; a file choice makes automatic the way back", () => {
    expect(rows(state({ dialect: "mysql", source: "filename" }))[1]).toEqual([
      "MySQL",
      "In use · from the file name",
    ]);
    expect(rows(state({ dialect: "sqlite", source: "hint" }))[2]?.[1]).toBe(
      "In use · from the file's comment"
    );
    expect(rows(state({ dialect: "generic", source: "default" }))[3]?.[1]).toBe(
      "In use · no hint found"
    );
    expect(rows(state({ source: "workspace", workspaceOverride: "postgresql" }))[0]?.[1]).toBe(
      "In use · chosen for polaris"
    );

    const overridden = rows(state({ dialect: "sqlite", source: "file", fileOverride: "sqlite" }));

    expect(overridden[2]?.[1]).toBe("In use · chosen for this file");
    expect(overridden.at(-1)).toEqual([
      "Use automatic detection",
      "From a polaris-sql-dialect comment, the file name or Prisma",
    ]);
  });

  test("a choice sets this file's dialect at the revision it was read at; automatic clears it", () => {
    chosen.length = 0;
    const choices = dialectFollowUp(state(), "polaris", (d, r) => chosen.push([d, r])).choices;

    choices.find((c) => c.title === "SQLite")?.run();
    choices.find((c) => c.title === "Use automatic detection")?.run();
    expect(chosen).toEqual([
      ["sqlite", 7],
      [null, 7],
    ]);
  });

  test("the palette lists it for a SQL file whose checkout is known, with what runs now", () => {
    const binding = KEYMAP.find((b) => b.id === "sql.selectDialect");

    expect(binding?.title).toBe("SQL: Select dialect…");
    expect(binding?.when).toEqual({ all: ["editor.file", "language.sql"] });

    const sql = {
      path: "/code/polaris/db/schema.sql",
      language: "sql" as const,
      providers: ["sqllens"],
      status: null,
      workspace: "polaris",
      canFormat: true,
      canShowLog: false,
      hasCheckout: true,
      pythonInterpreter: "",
      sqlDialect: dialectSummary(state(), "polaris"),
    };

    const { keys, values } = fileContext(sql);

    expect(keys).toContain("language.sql");
    expect(values?.sqlDialect).toBe("PostgreSQL · from Prisma's datasource");
    expect(fileContext({ ...sql, hasCheckout: false }).keys).not.toContain("language.sql");
    expect(fileContext({ ...sql, language: "python" }).keys).not.toContain("language.sql");
  });
});

describe("the status popover", () => {
  test("a Dialect row with its source, before the server", () => {
    expect(dialectFact(state(), "polaris")).toEqual({
      label: "Dialect",
      value: "PostgreSQL",
      note: "from Prisma's datasource",
    });
    expect(dialectFact(null, "polaris")).toBeNull();

    const view = statusView(input({ language: "SQL", sql: state() }));

    expect(view.facts.map((fact) => fact.label)).toEqual(["Dialect", "Server", "Host"]);
    expect(view.why).toContain("Hover, completions");
  });

  test("Generic SQL doesn't promise completion or diagnostics", () => {
    const view = statusView(
      input({ language: "SQL", sql: state({ dialect: "generic", source: "default" }) })
    );

    expect(view.why).toBe(
      "Formatting works. Generic SQL has no completion or diagnostics; choose a dialect for them."
    );
  });

  test("missing ShellCheck: needs shellcheck, the install command, and its reason said once", () => {
    const MAC = { os: "darwin", arch: "arm64", libc: "none" } as const;
    const reason = "ShellCheck enables shell diagnostics; Polaris never downloads it.";

    const bash: Discovered = {
      providerId: "bash-language-server",
      preflight: P.LanguagePreflight.cases.Blocked.make({
        reason: "missing-prerequisite",
        message: "No shellcheck",
      }),
      launch: null,
      prerequisites: [
        {
          requirement: {
            id: "shellcheck",
            scope: "companion",
            executable: "shellcheck",
            version: "present",
            detail: reason,
            required: true,
            installCommands: [
              { platforms: [MAC], label: "Homebrew", command: "brew install shellcheck" },
            ],
          },
          effectiveExecutable: null,
          detectedVersion: null,
          outcome: "missing",
          reason,
        },
      ],
    };

    const view = statusView(
      input({
        language: "Shell",
        file: file({ providers: [bash], contexts: {} }),
        runtimes: [],
        tools: { ...installedTools, platform: MAC },
      })
    );

    expect(view).toMatchObject({
      kind: "prerequisite",
      pill: "Shell · needs shellcheck",
      title: "Shell needs shellcheck",
      why: reason,
      commands: [{ label: "Homebrew", command: "brew install shellcheck" }],
    });
  });
});
