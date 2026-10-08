/**
 * Python interpreters as the Editor says them: "Python: Select interpreter…"'s
 * choices and the status popover's Interpreter row. Pure; the Host detects them
 * (`languages.python.interpreters`) without ever running Python.
 */
import type * as P from "@polaris/protocol";
import { Match } from "effect";
import type { FollowUp, FollowUpChoice } from "../../../routes/commands.ts";

export type Interpreters = typeof P.LanguagePythonInterpreters.Type;

export type Interpreter = Interpreters["interpreters"][number];

export const FOLLOW_UP_TITLE = "Select Python interpreter";

/** The environment's folder for a venv (".venv", "venv"), else where it came from. */
export const sourceLabel = (interpreter: Interpreter) =>
  Match.value(interpreter.source).pipe(
    Match.when("venv", () => interpreter.path.split("/").at(-3) ?? "venv"),
    Match.when("uv", () => "uv"),
    Match.when("host", () => "Host"),
    Match.when("override", () => "chosen"),
    Match.exhaustive
  );

/** Inside the checkout, relative (".venv/bin/python"); elsewhere, the Host's own path. */
export const shortPath = (path: string, root: string) => {
  const prefix = root.endsWith("/") ? root : `${root}/`;

  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
};

const versionText = (interpreter: Interpreter) =>
  interpreter.version === undefined ? "Python" : `Python ${interpreter.version}`;

/** "uv · 3.12.4": the palette row's caption for what runs now. */
export const interpreterSummary = (interpreters: Interpreters | null) => {
  const selected = selectedOf(interpreters);

  if (selected === null) return "";

  return [sourceLabel(selected), selected.version].filter((part) => part !== undefined).join(" · ");
};

export const selectedOf = (interpreters: Interpreters | null): Interpreter | null =>
  interpreters?.interpreters.find((i) => i.path === interpreters.selected) ?? null;

const checkoutRoot = (interpreters: Interpreters) => interpreters.checkout.path;

/** The popover row: version (or path) with its source; "None found" when nothing was. */
export const interpreterFact = (interpreters: Interpreters | null) => {
  if (interpreters === null) return null;
  const selected = selectedOf(interpreters);

  if (selected === null) return { label: "Interpreter", value: "None found" };

  return {
    label: "Interpreter",
    value: selected.version ?? shortPath(selected.path, checkoutRoot(interpreters)),
    mono: true,
    note:
      interpreters.override === null
        ? `${sourceLabel(selected)}, automatic`
        : sourceLabel(selected),
  };
};

export type Choose = (interpreter: string | null, expectedRevision: number) => void;

export const LOOKING: FollowUp = {
  title: FOLLOW_UP_TITLE,
  choices: [
    { id: "looking", title: "Looking for interpreters…", disabled: true, run: () => undefined },
  ],
};

export const failedFollowUp = (message: string): FollowUp => ({
  title: FOLLOW_UP_TITLE,
  choices: [
    {
      id: "failed",
      title: "Couldn't list interpreters",
      detail: message,
      disabled: true,
      run: () => undefined,
    },
  ],
});

/** Each detected interpreter (version, source, path), then "Use automatic detection". */
export const interpreterFollowUp = (
  interpreters: Interpreters,
  host: string,
  choose: Choose
): FollowUp => {
  const root = checkoutRoot(interpreters);
  const { revision, override } = interpreters;

  const rows: FollowUpChoice[] = interpreters.interpreters.map((interpreter) => {
    const inUse = interpreter.path === interpreters.selected;
    const where = `${sourceLabel(interpreter)} · ${shortPath(interpreter.path, root)}`;

    return {
      id: interpreter.path,
      title: `${versionText(interpreter)} · ${sourceLabel(interpreter)}`,
      detail: inUse ? `In use · ${where}` : where,
      run: () => choose(interpreter.path, revision),
    };
  });

  const none: FollowUpChoice = {
    id: "none",
    title: "No Python found",
    detail: `Add a .venv, or install Python on ${host}`,
    disabled: true,
    run: () => undefined,
  };

  const detected = interpreters.interpreters.find((i) => i.source !== "override") ?? null;

  const automaticDetail = () => {
    const found = detected === null ? null : sourceLabel(detected);

    if (override === null) return found === null ? "In use" : `In use · ${found}`;

    return found === null ? "Nothing detected" : `Would use ${found}`;
  };

  const automatic: FollowUpChoice = {
    id: "automatic",
    title: "Use automatic detection",
    detail: automaticDetail(),
    run: () => choose(null, revision),
  };

  return {
    title: FOLLOW_UP_TITLE,
    choices: [...(rows.length === 0 ? [none] : rows), automatic],
  };
};
