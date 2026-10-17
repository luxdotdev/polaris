import { describe, expect, test } from "bun:test";
import { planWindowsTask, type WindowsTaskFacts } from "./windowsService.ts";

const facts = (overrides: Partial<WindowsTaskFacts>): WindowsTaskFacts => ({
  registered: true,
  changed: { binary: false, serviceFile: false },
  running: { pid: 42, version: "0.2.0" },
  version: "0.2.0",
  ...overrides,
});

describe("planWindowsTask", () => {
  test("a second install of what already runs touches nothing", () => {
    expect(planWindowsTask(facts({}))).toEqual({ register: false, stop: null, start: false });
  });

  test("a new binary stops the running Daemon as an upgrade, then starts the task", () => {
    expect(
      planWindowsTask(facts({ changed: { binary: true, serviceFile: false }, version: "0.2.1" }))
    ).toEqual({ register: false, stop: "upgrade", start: true });
  });

  test("a Daemon of another version is replaced even when the files were already in place", () => {
    expect(planWindowsTask(facts({ version: "0.2.1" }))).toMatchObject({ stop: "upgrade" });
  });

  test("a changed task definition re-registers and restarts, since the running loop is the old one", () => {
    expect(planWindowsTask(facts({ changed: { binary: false, serviceFile: true } }))).toEqual({
      register: true,
      stop: "restart",
      start: true,
    });
  });

  test("a task removed by hand is registered again", () => {
    expect(planWindowsTask(facts({ registered: false, running: null }))).toEqual({
      register: true,
      stop: null,
      start: true,
    });
  });

  test("with no Daemon answering, the task is started without stopping anything", () => {
    expect(planWindowsTask(facts({ running: null }))).toEqual({
      register: false,
      stop: null,
      start: true,
    });
  });
});
