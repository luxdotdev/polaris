import { expect, test } from "bun:test";
import { BackgroundTask, TurnTrigger } from "@polaris/protocol";
import { triggerPhrase, waitingOn, waitingPhrase } from "./background.ts";

const task = (id: string, kind: "subagent" | "command") =>
  new BackgroundTask({ id, kind, description: `task ${id}` });

const trigger = (...kinds: ReadonlyArray<"subagent" | "command">) =>
  TurnTrigger.cases.BackgroundTasksReported.make({
    tasks: kinds.map((kind, n) => ({ id: `t${n}`, kind })),
  });

test("waiting says what it waits on, one kind or both", () => {
  expect(waitingPhrase([task("a", "subagent"), task("b", "subagent")])).toBe(
    "Waiting on 2 subagents"
  );
  expect(waitingPhrase([task("a", "command")])).toBe("Waiting on a command");
  expect(waitingPhrase([task("a", "subagent"), task("b", "command")])).toBe(
    "Waiting on 1 subagent and 1 command"
  );
  expect(waitingPhrase([task("a", "subagent"), task("b", "command"), task("c", "command")])).toBe(
    "Waiting on 1 subagent and 2 commands"
  );
});

test("only an Idle session waits; Working and Needs You keep their own line", () => {
  const tasks = [task("a", "subagent")];

  expect(waitingOn({ state: "idle", backgroundTasks: tasks })).toEqual(tasks);
  expect(waitingOn({ state: "working", backgroundTasks: tasks })).toEqual([]);
  expect(waitingOn({ state: "needs-you", backgroundTasks: tasks })).toEqual([]);
  expect(waitingOn({ state: "idle", backgroundTasks: [] })).toEqual([]);
});

test("a self-started Turn names the reports that woke it", () => {
  expect(triggerPhrase(trigger("subagent", "subagent"))).toBe("2 subagents reported");
  expect(triggerPhrase(trigger("command"))).toBe("A command finished");
  expect(triggerPhrase(trigger("subagent", "command", "command"))).toBe(
    "A subagent reported and 2 commands finished"
  );
  expect(triggerPhrase(trigger())).toBe("Continued on its own");
});
