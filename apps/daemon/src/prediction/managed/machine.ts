/**
 * The managed model server's lifecycle (ADR 0049), a pure decider: the service feeds it
 * what happened and acts on the state it lands in. Mirrors `languages/runtime/lifecycle.ts`.
 */
import { createMachine, transition, types } from "xstate";

export type ManagedEvent =
  | { type: "unsupported" }
  | { type: "setup" }
  | { type: "downloaded" }
  | { type: "download-failed" }
  | { type: "cancel" }
  | { type: "demand" }
  | { type: "listening" }
  | { type: "exit"; retry: boolean }
  | { type: "retry" }
  | { type: "idle" }
  | { type: "stop" }
  | { type: "remove" };

export const managedLifecycle = createMachine({
  id: "managed-model-server",
  schemas: {
    events: {
      unsupported: types<Record<never, never>>(),
      setup: types<Record<never, never>>(),
      downloaded: types<Record<never, never>>(),
      "download-failed": types<Record<never, never>>(),
      cancel: types<Record<never, never>>(),
      demand: types<Record<never, never>>(),
      listening: types<Record<never, never>>(),
      exit: types<{ retry: boolean }>(),
      retry: types<Record<never, never>>(),
      idle: types<Record<never, never>>(),
      stop: types<Record<never, never>>(),
      remove: types<Record<never, never>>(),
    },
  },
  initial: "absent",
  on: {
    unsupported: { target: ".unsupported" },
    remove: { target: ".absent" },
  },
  states: {
    unsupported: {},
    absent: { on: { setup: { target: "downloading" } } },
    downloading: {
      on: {
        downloaded: { target: "stopped" },
        "download-failed": { target: "failed" },
        cancel: { target: "absent" },
      },
    },
    stopped: { on: { demand: { target: "starting" }, setup: { target: "downloading" } } },
    starting: {
      on: {
        listening: { target: "serving" },
        exit: ({ event }) => ({ target: event.retry ? "backoff" : "failed" }),
        stop: { target: "stopped" },
      },
    },
    serving: {
      on: {
        exit: ({ event }) => ({ target: event.retry ? "backoff" : "failed" }),
        idle: { target: "stopped" },
        stop: { target: "stopped" },
      },
    },
    backoff: { on: { retry: { target: "starting" }, stop: { target: "stopped" } } },
    failed: { on: { setup: { target: "downloading" }, demand: { target: "starting" } } },
  },
});

export type ManagedState = ReturnType<typeof managedLifecycle.getInitialSnapshot>;

export const managedInitial = () => managedLifecycle.resolveState({ value: "absent" });

export const decideManaged = (state: ManagedState, event: ManagedEvent) =>
  transition(managedLifecycle, state, event)[0];
