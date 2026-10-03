import {
  ConstellationEvent,
  MessageTarget,
  PlanOperation,
  Task,
  type TaskId,
} from "@polaris/protocol";
import type { GraphCommand } from "../engine/constellation.inputs.ts";
import { taskData } from "./data.ts";
import { GraphDecision } from "./decision.ts";
import { cancelBlockTarget } from "./blocked.ts";
import { latestAttempt } from "./projections.ts";
import { cancelSubtrees, effectiveDeps, validateParents } from "./parents.ts";
import { waitCycleMessage, waitGraph } from "./waitGraph.ts";

/** Validate the resulting graph, so forward references and removing a dependency in the same batch work. */
export const validateGraph = (d: GraphDecision, tasks: ReadonlyArray<Task>) => {
  validateParents(d, tasks);
  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks.filter((t) => !t.canceled)) {
    for (const dep of effectiveDeps(tasks, task.id)) {
      const dependency = byId.get(dep);

      if (dependency === undefined)
        d.reject(
          "E-DEP-UNKNOWN",
          `${task.id} depends on unknown Task ${dep}`,
          `Add ${dep} or remove it from ${task.id}'s dependencies.`
        );
      else if (dependency.canceled)
        d.reject(
          "E-CANCEL-DEPENDENTS",
          `${dep} is canceled but ${task.id} depends on it`,
          `Remove ${dep} from ${task.id}, or cancel ${task.id} in the same batch.`
        );
    }
  }

  const visiting = new Set<TaskId>();
  const visited = new Set<TaskId>();
  const cycles = new Set<string>();
  const edges = waitGraph(tasks, d.record.graph.attempts);

  const walk = (id: TaskId, path: ReadonlyArray<TaskId>) => {
    if (visiting.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id];
      const key = [...new Set(cycle)].sort().join(",");

      if (!cycles.has(key)) {
        cycles.add(key);
        d.reject(
          "E-DEP-CYCLE",
          waitCycleMessage(edges, cycle),
          "Remove a dependency or unblock an Attempt in this cycle."
        );
      }

      return;
    }

    if (visited.has(id)) return;
    visiting.add(id);

    for (const edge of edges.get(id) ?? [])
      if (byId.has(edge.target)) walk(edge.target, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };

  for (const task of tasks) walk(task.id, []);
};

export const plan = (d: GraphDecision, command: GraphCommand<"Plan">) => {
  const candidate = new Map(d.record.graph.tasks.map((task) => [task.id, task]));
  const changed = new Set<TaskId>();
  const cancelRoots = new Set<TaskId>();

  for (const op of command.operations) {
    const id = PlanOperation.match(op, {
      Add: ({ task }) => task.id,
      Edit: ({ taskId }) => taskId,
      Cancel: ({ taskId }) => taskId,
    });

    if (changed.has(id)) {
      d.reject(
        "E-PLAN-DUPLICATE",
        `Task ${id} occurs twice in the batch`,
        "Use one operation per Task."
      );
      continue;
    }

    changed.add(id);
    const current = candidate.get(id);
    PlanOperation.match(op, {
      Add: ({ task }) => {
        if (current !== undefined)
          d.reject(
            "E-TASK-EXISTS",
            `Task ${id} already exists`,
            `Edit ${id} at revision ${current.revision}.`
          );
        else candidate.set(id, new Task({ ...taskData(task), revision: 0, canceled: false }));
      },
      Edit: ({ task, revision }) => {
        if (current === undefined)
          d.reject("E-TASK-UNKNOWN", `Task ${id} does not exist`, `Add ${id} first.`);
        else if (current.revision !== revision)
          d.reject(
            "E-REVISION",
            `Task ${id} is at revision ${current.revision}`,
            "Read status and retry with the current Task revision."
          );
        else if (task.id !== id || current.canceled)
          d.reject(
            "E-TASK-EDIT",
            `Task ${id} cannot be renamed or revived`,
            "Declare a new Task with a new id."
          );
        else
          candidate.set(
            id,
            new Task({ ...taskData(task), revision: revision + 1, canceled: false })
          );
      },
      Cancel: ({ revision }) => {
        if (current === undefined)
          d.reject(
            "E-TASK-UNKNOWN",
            `Task ${id} does not exist`,
            "Read status for the current Task ids."
          );
        else if (current.revision !== revision)
          d.reject(
            "E-REVISION",
            `Task ${id} is at revision ${current.revision}`,
            "Read status and retry with the current Task revision."
          );
        else cancelRoots.add(id);
      },
    });
  }

  for (const resource of command.resources) {
    if (resource.name === "__workers")
      d.reject(
        "E-RESOURCE-RESERVED",
        "__workers is the reserved worker slot resource",
        "Change the worker cap in Host settings."
      );

    const holders =
      d.ctx.resourceHolders.find(
        (held) => held.hostId === resource.hostId && held.name === resource.name
      )?.holders ?? 0;

    if (resource.capacity < holders)
      d.reject(
        "E-RESOURCE-CAPACITY",
        `${resource.name} has ${holders} active holders`,
        "Release holders before reducing capacity below that count."
      );
  }

  const cancellations = cancelSubtrees(d, candidate, cancelRoots);
  const declarations = new Map(candidate);

  for (const task of cancellations)
    candidate.set(
      task.id,
      new Task({ ...taskData(task), revision: task.revision + 1, canceled: true })
    );
  validateGraph(d, [...candidate.values()]);

  if (d.findings.length > 0) return;

  for (const op of command.operations)
    PlanOperation.match(op, {
      Add: ({ task }) => {
        const next = declarations.get(task.id);

        if (next !== undefined)
          d.emit(ConstellationEvent.cases.TaskDeclared.make({ ...d.fields(), task: next }));
      },
      Edit: ({ taskId }) => {
        const old = d.record.graph.tasks.find((task) => task.id === taskId);
        const task = declarations.get(taskId);

        if (task === undefined) return;
        d.emit(ConstellationEvent.cases.TaskEdited.make({ ...d.fields(), task }));
        const worker = latestAttempt(d.record.graph, taskId);

        if (worker?.state === "working" && old?.brief !== task.brief) {
          const fields = d.fields();
          d.emit(
            ConstellationEvent.cases.OperatorMessageSent.make({
              ...fields,
              id: `${fields.constellationId}:${fields.revision}:brief`,
              target: MessageTarget.cases.Worker.make({ attemptId: worker.id }),
              authority: "conversation",
              text: task.brief,
              questionId: null,
            })
          );
        }
      },
      Cancel: () => {},
    });

  for (const task of cancellations) cancelBlockTarget(d, task.id, task.revision + 1);
};
