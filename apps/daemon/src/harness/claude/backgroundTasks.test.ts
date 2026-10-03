import { expect, test } from "bun:test";
import type {
  SDKBackgroundTasksChangedMessage,
  SDKTaskNotificationMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeBackgroundTasks } from "./backgroundTasks.ts";

const level = (
  tasks: SDKBackgroundTasksChangedMessage["tasks"]
): SDKBackgroundTasksChangedMessage => ({
  type: "system",
  subtype: "background_tasks_changed",
  tasks,
  uuid: crypto.randomUUID(),
  session_id: "s",
});

const notification = (task_id: string): SDKTaskNotificationMessage => ({
  type: "system",
  subtype: "task_notification",
  task_id,
  status: "completed",
  output_file: "",
  summary: "done",
  uuid: crypto.randomUUID(),
  session_id: "s",
});

test("the level replaces membership, hides ambient watchers, and accepts Monitor as a command", () => {
  const tasks = new ClaudeBackgroundTasks();
  const agent = { task_id: "a", task_type: "local_agent", description: "Research" };
  const monitor = { task_id: "m", task_type: "local_monitor", description: "Wait for build" };
  const ambient = { task_id: "w", task_type: "local_watch", description: "Watcher", ambient: true };
  expect(tasks.onMessage(level([agent, monitor, ambient]))).toMatchObject([
    {
      tasks: [
        { id: "a", kind: "subagent" },
        { id: "m", kind: "command" },
      ],
    },
  ]);
  expect(tasks.onMessage(level([agent, monitor, ambient]))).toEqual([]);
  expect(tasks.onMessage(level([]))).toMatchObject([{ tasks: [] }]);
  tasks.onMessage(notification("m"));
  tasks.onMessage(notification("a"));
  tasks.onMessage(notification("a"));
  tasks.onMessage(notification("w"));
  expect(tasks.takeReports()).toEqual([
    { id: "a", kind: "subagent" },
    { id: "m", kind: "command" },
  ]);
  expect(tasks.takeReports()).toEqual([]);
});

test("a notification before the level drops membership still reports exactly once", () => {
  const tasks = new ClaudeBackgroundTasks();
  tasks.onMessage(level([{ task_id: "c", task_type: "local_bash", description: "Sleep" }]));
  expect(tasks.onMessage(notification("c"))).toEqual([]);
  expect(tasks.onMessage(level([]))).toMatchObject([{ tasks: [] }]);
  tasks.onMessage(notification("c"));
  expect(tasks.takeReports()).toEqual([{ id: "c", kind: "command" }]);
});

test("ambient level changes cannot be undone by a later task_started edge", () => {
  const tasks = new ClaudeBackgroundTasks();
  tasks.onMessage(
    level([{ task_id: "w", task_type: "local_bash", description: "Watch", ambient: true }])
  );
  expect(
    tasks.onMessage({
      type: "system",
      subtype: "task_started",
      task_id: "w",
      task_type: "local_bash",
      is_backgrounded: true,
      description: "Watch",
      uuid: crypto.randomUUID(),
      session_id: "s",
    })
  ).toEqual([]);
  tasks.onMessage(notification("w"));
  expect(tasks.takeReports()).toEqual([]);
});

test("empty reports share storage and removed membership is pruned before later notifications", () => {
  const tasks = new ClaudeBackgroundTasks();
  expect(tasks.takeReports()).toBe(tasks.takeReports());
  tasks.onMessage(level([{ task_id: "gone", task_type: "local_bash", description: "Build" }]));
  tasks.onMessage(level([]));
  expect(tasks.takeReports()).toEqual([{ id: "gone", kind: "command" }]);
  tasks.onMessage(notification("gone"));
  expect(tasks.takeReports()).toEqual([]);
});
