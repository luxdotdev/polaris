import { createMachine, transition, types } from "xstate";

export type LifecycleEvent =
  | { type: "demand" }
  | { type: "ready" }
  | { type: "empty" }
  | { type: "grace" }
  | { type: "crash"; retry: boolean }
  | { type: "retry" }
  | { type: "disconnect" }
  | { type: "revoke" }
  | { type: "restart" }
  | { type: "stop" };

export const languageLifecycle = createMachine({
  id: "language-process",
  schemas: {
    events: {
      demand: types<Record<never, never>>(),
      ready: types<Record<never, never>>(),
      empty: types<Record<never, never>>(),
      grace: types<Record<never, never>>(),
      crash: types<{ retry: boolean }>(),
      retry: types<Record<never, never>>(),
      disconnect: types<Record<never, never>>(),
      revoke: types<Record<never, never>>(),
      restart: types<Record<never, never>>(),
      stop: types<Record<never, never>>(),
    },
  },
  initial: "stopped",
  on: {
    disconnect: { target: ".stopped" },
    revoke: { target: ".untrusted" },
    stop: { target: ".stopped" },
    restart: { target: ".stopped" },
  },
  states: {
    stopped: { on: { demand: { target: "starting" } } },
    untrusted: { on: { demand: { target: "starting" } } },
    starting: {
      on: {
        ready: { target: "ready" },
        empty: { target: "grace" },
        crash: ({ event }) => ({ target: event.retry ? "backoff" : "failed" }),
      },
    },
    ready: {
      on: {
        empty: { target: "grace" },
        crash: ({ event }) => ({ target: event.retry ? "backoff" : "failed" }),
      },
    },
    grace: {
      on: {
        demand: { target: "ready" },
        grace: { target: "stopped" },
        ready: {},
        crash: ({ event }) => ({ target: event.retry ? "backoff" : "failed" }),
      },
    },
    backoff: { on: { retry: { target: "starting" }, empty: { target: "stopped" } } },
    failed: {},
  },
});

export type LifecycleState = ReturnType<typeof languageLifecycle.getInitialSnapshot>;

export const lifecycleInitial = () => languageLifecycle.resolveState({ value: "stopped" });

export const decideLifecycle = (state: LifecycleState, event: LifecycleEvent) =>
  transition(languageLifecycle, state, event)[0];
