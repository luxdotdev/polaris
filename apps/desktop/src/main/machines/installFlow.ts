/**
 * A remote Host's install flow as a flat state machine (`xstate/fsm`): check
 * (probe and plan), ask for the one-time approval, install or upgrade, done.
 * Pure; `Machines` runs the probes and uploads and feeds it their results.
 * The diagram is in `README.md` next to this file.
 *
 * - Only a check the user started may install. A background check (a
 *   reconnect) that finds no Daemon asks for approval instead, even when the
 *   build's SHA-256 was approved before.
 * - Upgrades need no new approval and may run on a background check; the
 *   outcome says the upgrade happened.
 * - "Not now" parks the Host until the user checks again; background checks
 *   leave it parked.
 */
import type { InstallPlan, InstallTrigger } from "@polaris/client/install";
import { Match } from "effect";
import { setup, types } from "xstate/fsm";

/** What a first install will put on the Host, for the approval card. */
export interface InstallOffer {
  readonly platform: string;
  readonly version: string;
  readonly sha256: string;
}

export type InstallWork = Extract<InstallPlan, { _tag: "Install" | "Upgrade" }>;

export interface InstallOutcome {
  readonly kind: "current" | "newer" | "installed" | "upgraded";
  readonly version: string;
  /** Upgrades: the version it replaced. */
  readonly from: string | null;
  /** The Daemon's report notes (e.g. the fallback supervisor, linger needing an admin). */
  readonly notes: ReadonlyArray<string>;
  /** Linux: what an administrator must run so the Daemon survives logout (linger). */
  readonly adminCommand: string | null;
}

export interface InstallProblem {
  /** `ssh`: ssh itself failed (host key, auth, unreachable); the Connection State says why. */
  readonly kind: "unsupported" | "missing-build" | "host-setup" | "ssh" | "failed";
  readonly message: string;
  /** What an administrator must run on the Host (host setup, linger). */
  readonly command: string | null;
}

export interface InstallContext {
  readonly trigger: InstallTrigger | null;
  readonly offer: InstallOffer | null;
  readonly work: InstallWork | null;
  readonly outcome: InstallOutcome | null;
  readonly problem: InstallProblem | null;
}

export type InstallEvent =
  | { readonly type: "check"; readonly trigger: InstallTrigger }
  | { readonly type: "planned"; readonly plan: InstallPlan }
  | { readonly type: "approve" }
  | { readonly type: "dismiss" }
  | { readonly type: "applied"; readonly outcome: InstallOutcome }
  | { readonly type: "failed"; readonly problem: InstallProblem };

type Planned = Extract<InstallEvent, { type: "planned" }>;

const cleared = { offer: null, work: null, outcome: null, problem: null };

type Askable = InstallWork | Extract<InstallPlan, { _tag: "NeedsApproval" }>;

const offerOf = (plan: Askable): InstallOffer =>
  Match.value(plan).pipe(
    Match.tagsExhaustive({
      NeedsApproval: ({ platform, version, sha256 }) => ({ platform, version, sha256 }),
      Install: ({ build }) => ({
        platform: build.platform,
        version: build.version,
        sha256: build.sha256,
      }),
      Upgrade: ({ build }) => ({
        platform: build.platform,
        version: build.version,
        sha256: build.sha256,
      }),
    })
  );

const ask = (plan: Askable) => ({
  target: "approval" as const,
  context: { ...cleared, offer: offerOf(plan) },
});

const blocked = (problem: InstallProblem) => ({
  target: "blocked" as const,
  context: { ...cleared, problem },
});

const ready = (outcome: InstallOutcome) => ({
  target: "ready" as const,
  context: { ...cleared, outcome },
});

/** Where a plan leaves the Host; an install the user didn't start becomes a question. */
const planned = ({ context, event }: { context: InstallContext; event: Omit<Planned, "type"> }) =>
  Match.value(event.plan).pipe(
    Match.tagsExhaustive({
      NeedsApproval: (plan) => ask(plan),
      Install: (plan) =>
        context.trigger === "user"
          ? { target: "installing" as const, context: { ...cleared, work: plan } }
          : ask(plan),
      Upgrade: (plan) => ({ target: "installing" as const, context: { ...cleared, work: plan } }),
      UpToDate: ({ version }) =>
        ready({ kind: "current", version, from: null, notes: [], adminCommand: null }),
      InstalledNewer: ({ installed }) =>
        ready({ kind: "newer", version: installed, from: null, notes: [], adminCommand: null }),
      Unsupported: ({ os, arch }) =>
        blocked({
          kind: "unsupported",
          message: `Polaris doesn't run on ${os} ${arch} yet.`,
          command: null,
        }),
      MissingBuild: ({ platform }) =>
        blocked({
          kind: "missing-build",
          message: `This app carries no ${platform} daemon build.`,
          command: null,
        }),
      MissingLibraries: ({ libraries, command }) =>
        blocked({
          kind: "host-setup",
          message: `The host lacks ${libraries.join(" and ")}, which the daemon needs.`,
          command,
        }),
    })
  );

const check =
  (fromParked: boolean) =>
  ({ event }: { event: { readonly trigger: InstallTrigger } }) =>
    fromParked && event.trigger === "background"
      ? undefined
      : { target: "checking" as const, context: { ...cleared, trigger: event.trigger } };

export const installMachine = setup({
  schemas: {
    context: types<InstallContext>(),
    events: {
      check: types<{ readonly trigger: InstallTrigger }>(),
      planned: types<Omit<Planned, "type">>(),
      approve: types<Record<never, never>>(),
      dismiss: types<Record<never, never>>(),
      applied: types<{ readonly outcome: InstallOutcome }>(),
      failed: types<{ readonly problem: InstallProblem }>(),
    },
  },
}).createFSM({
  id: "install",
  initial: "idle",
  context: { trigger: null, ...cleared },
  states: {
    idle: { on: { check: check(false) } },
    checking: {
      on: {
        planned,
        failed: ({ event }) => blocked(event.problem),
      },
    },
    approval: {
      on: {
        // The approved SHA-256 is recorded first, so the user's re-check installs.
        approve: () => ({ target: "checking", context: { ...cleared, trigger: "user" } }),
        dismiss: ({ context }) => ({ target: "dismissed", context: { offer: context.offer } }),
        check: check(true),
      },
    },
    dismissed: { on: { check: check(true) } },
    installing: {
      on: {
        applied: ({ event }) => ready(event.outcome),
        failed: ({ event }) => blocked(event.problem),
      },
    },
    ready: { on: { check: check(false) } },
    blocked: { on: { check: check(false) } },
  },
});

export type InstallSnapshot = typeof installMachine.initialState;

export type InstallStep = InstallSnapshot["value"];

export const initialInstall = (): InstallSnapshot => installMachine.initialState;

export const stepInstall = (snapshot: InstallSnapshot, event: InstallEvent): InstallSnapshot =>
  installMachine.transition(snapshot, event)[0];
