/**
 * SQL dialects as the Editor says them: "SQL: Select dialect…"'s choices and
 * the status popover's Dialect row. Pure; the Host decides the dialect
 * (`languages.sql.dialect.get`) from overrides, a hint comment, the file name or Prisma.
 */
import type * as P from "@polaris/protocol";
import { Match } from "effect";
import type { FollowUp, FollowUpChoice } from "../../../routes/commands.ts";

export type DialectState = typeof P.LanguageSqlDialectState.Type;

export type Dialect = P.LanguageSqlDialect;

export const FOLLOW_UP_TITLE = "Select SQL dialect";

export const DIALECTS: ReadonlyArray<Dialect> = ["postgresql", "mysql", "sqlite", "generic"];

export const dialectName = (dialect: Dialect) =>
  Match.value(dialect).pipe(
    Match.when("postgresql", () => "PostgreSQL"),
    Match.when("mysql", () => "MySQL"),
    Match.when("sqlite", () => "SQLite"),
    Match.when("generic", () => "Generic SQL"),
    Match.exhaustive
  );

/** Where the dialect in use came from, as a caption. */
export const sourceText = (state: DialectState, workspace: string) =>
  Match.value(state.source).pipe(
    Match.when("file", () => "chosen for this file"),
    Match.when("workspace", () => `chosen for ${workspace}`),
    Match.when("hint", () => "from the file's comment"),
    Match.when("filename", () => "from the file name"),
    Match.when("prisma", () => "from Prisma's datasource"),
    Match.when("default", () => "no hint found"),
    Match.exhaustive
  );

/** "PostgreSQL · from Prisma's datasource": the palette row's caption for what runs now. */
export const dialectSummary = (state: DialectState | null, workspace: string) =>
  state === null ? "" : `${dialectName(state.dialect)} · ${sourceText(state, workspace)}`;

export const dialectFact = (state: DialectState | null, workspace: string) =>
  state === null
    ? null
    : { label: "Dialect", value: dialectName(state.dialect), note: sourceText(state, workspace) };

/** What each dialect gets from the bundled server: generic formats only. */
const capability = (dialect: Dialect) =>
  dialect === "generic" ? "Formatting only" : "Completion and diagnostics";

export type Choose = (dialect: Dialect | null, expectedRevision: number) => void;

export const LOOKING: FollowUp = {
  title: FOLLOW_UP_TITLE,
  choices: [{ id: "looking", title: "Reading the dialect…", disabled: true, run: () => undefined }],
};

export const failedFollowUp = (message: string): FollowUp => ({
  title: FOLLOW_UP_TITLE,
  choices: [
    {
      id: "failed",
      title: "Couldn't read the dialect",
      detail: message,
      disabled: true,
      run: () => undefined,
    },
  ],
});

/** The four dialects, the one in use marked with where it came from, then automatic detection. */
export const dialectFollowUp = (
  state: DialectState,
  workspace: string,
  choose: Choose
): FollowUp => {
  const rows: FollowUpChoice[] = DIALECTS.map((dialect) => ({
    id: dialect,
    title: dialectName(dialect),
    detail:
      dialect === state.dialect ? `In use · ${sourceText(state, workspace)}` : capability(dialect),
    run: () => choose(dialect, state.revision),
  }));

  const automatic: FollowUpChoice = {
    id: "automatic",
    title: "Use automatic detection",
    detail:
      state.fileOverride === null
        ? "In use"
        : "From a polaris-sql-dialect comment, the file name or Prisma",
    run: () => choose(null, state.revision),
  };

  return { title: FOLLOW_UP_TITLE, note: "For this file only.", choices: [...rows, automatic] };
};
