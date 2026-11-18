/**
 * Test preload the watchdog adds when quarantine applies (`quarantine.ts`): wraps `bun:test`'s
 * `test`, `it` and `describe` so each test's full name can be matched against the entries.
 *
 * `POLARIS_TEST_QUARANTINE=skip` skips the quarantined tests and prints each one;
 * `only` skips every other test, for the nightly's `--quarantined` run.
 */
import * as bunTest from "bun:test";
import { Predicate } from "effect";
import {
  appliesOn,
  currentOs,
  describeEntry,
  type Entry,
  quarantineSource,
  readQuarantine,
  repoPath,
} from "./quarantine.ts";

/** The real module, copied before `mock.module` replaces its live bindings. */
const original = { ...bunTest };

const { test, describe } = original;

type Cell = string | number | bigint | boolean | symbol | object | null | undefined;

type Body = Parameters<typeof test>[1];

type Options = Parameters<typeof test>[2];

type EachTest = bunTest.Test<[Cell]>;

type EachBody = Parameters<EachTest>[1];

type Label = Parameters<typeof describe>[0];

type EachDescribe = bunTest.Describe<[Cell]>;

type Group = Parameters<EachDescribe>[1];

const mode = process.env.POLARIS_TEST_QUARANTINE === "only" ? "only" : "skip";

const os = currentOs();

const { root } = quarantineSource();

const entries = readQuarantine().filter((entry) => appliesOn(entry, os));

/** The names of the `describe` blocks being collected, outermost first. */
const stack: Array<string> = [];

const labelOf = (label: Label): string =>
  Predicate.isString(label) || Predicate.isNumber(label) ? String(label) : label.name;

const quarantinedIn = (file: string, name: string): Entry | undefined => {
  const full = [...stack, name].join(" > ");

  return entries.find((entry) => entry.file === file && entry.test === full);
};

/** Runs `run` or `skip` for the test `label` declares, per the mode; prints each quarantine skip. */
const decide = (label: string, run: () => void, skip: () => void): void => {
  const entry = quarantinedIn(repoPath(Bun.main, root), label);

  if (mode === "only") return entry ? run() : skip();

  if (!entry) return run();

  console.error(`(quarantined) skipped ${describeEntry(entry)}`);
  skip();
};

/** `base.each`, read only when a test calls it: `skipIf(true)` hands back `test.skip`. */
const eachTest =
  (base: typeof test) =>
  (table: Array<Cell>) =>
  (label: string, fn: EachBody, options?: Options): void =>
    decide(
      label,
      () => base.each(table)(label, fn, options),
      () => test.skip.each(table)(label, fn, options)
    );

const wrapTest = (base: typeof test) =>
  Object.assign(
    (label: string, fn: Body, options?: Options): void =>
      decide(
        label,
        () => base(label, fn, options),
        () => test.skip(label, fn, options)
      ),
    { each: eachTest(base) }
  );

/**
 * Bun's modifiers aren't own properties, so they're named here, on the root only: `.skip` of
 * `test.skip` (what `skipIf(true)` returns) throws, and so does `.only` under CI.
 */
const wrappedTest = Object.assign(wrapTest(test), {
  skip: test.skip,
  todo: test.todo,
  failing: test.failing,
  concurrent: test.concurrent,
  todoIf: (condition: boolean) => test.todoIf(condition),
  if: (condition: boolean) => wrapTest(test.if(condition)),
  skipIf: (condition: boolean) => wrapTest(test.skipIf(condition)),
});

/** Collects `fn` under its full path: bun runs a nested `describe` after its parent's returns. */
const within = <Row extends ReadonlyArray<Cell>>(
  label: Label,
  fn: (...row: Row) => void
): ((...row: Row) => void) => {
  const path = [...stack, labelOf(label)];

  return (...row) => {
    const saved = stack.splice(0, stack.length, ...path);

    try {
      fn(...row);
    } finally {
      stack.splice(0, stack.length, ...saved);
    }
  };
};

const wrapDescribe = (base: typeof describe) =>
  Object.assign((label: Label, fn: () => void) => base(label, within(label, fn)), {
    each: (table: Array<Cell>) => (label: Label, fn: Group) =>
      base.each(table)(label, within(label, fn)),
  });

const wrappedDescribe = Object.assign(wrapDescribe(describe), {
  skip: describe.skip,
  todo: describe.todo,
  todoIf: (condition: boolean) => describe.todoIf(condition),
  if: (condition: boolean) => wrapDescribe(describe.if(condition)),
  skipIf: (condition: boolean) => wrapDescribe(describe.skipIf(condition)),
});

if (entries.length > 0 || mode === "only")
  void bunTest.mock.module("bun:test", () => ({
    ...original,
    test: wrappedTest,
    it: wrappedTest,
    describe: wrappedDescribe,
  }));
