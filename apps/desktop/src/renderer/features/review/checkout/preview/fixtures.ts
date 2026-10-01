/** The checkout chip's states and menus on fixtures, as Paper R4 (804-0) and R5 (8B5-0) draw them. */
import {
  ReviewCheckout,
  ReviewCheckoutBlock,
  ReviewCheckoutBlocker,
  ReviewCheckoutId,
  type ReviewSubject,
  WorkspaceId,
} from "@polaris/protocol";
import { Data } from "effect";
import type { OpenPull } from "../../../../../shared/api.ts";
import type { CompareView } from "../../../../../shared/github.ts";
import type { Held } from "../actions.ts";
import { blockView, type ChipView } from "../model/chip.ts";
import type { HostChoice } from "../model/hosts.ts";
import type { CheckoutModel } from "../useCheckout.ts";

const Subjects = Data.taggedEnum<ReviewSubject>();

export const PULL: OpenPull = {
  repo: { owner: "work-org", name: "nj-homes" },
  number: 88,
  pullId: "PR_88",
};

const checkout = (patch: Partial<ReviewCheckout> = {}) =>
  new ReviewCheckout({
    id: ReviewCheckoutId.make("c88"),
    workspaceId: WorkspaceId.make("w1"),
    subject: Subjects.PullRequest({
      pullRequest: {
        repo: { host: "github.com", owner: "work-org", name: "nj-homes" },
        number: 88,
      },
      baseRef: "nightly",
    }),
    path: "/home/lucas/code/nj-homes.worktrees/.review/pr-88",
    state: "ready",
    blocked: null,
    head: "4f2c1a9e2b",
    mergeBase: "b1",
    latestHead: "4f2c1a9e2b",
    latestBase: "b0",
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  });

const failed = new ReviewCheckoutBlock({
  during: "fetch",
  blocker: ReviewCheckoutBlocker.cases.FetchFailed.make({
    message: "git fetch: Permission denied (publickey) · github.com:work-org",
  }),
});

const dirty = new ReviewCheckoutBlock({
  during: "remove",
  blocker: ReviewCheckoutBlocker.cases.Dirty.make({
    paths: ["api/eligibility.ts", "forms/limits.ts"],
  }),
});

/** Every state the chip can reach, in R5's order, with what it means. */
export const STATES: ReadonlyArray<{ readonly name: string; readonly view: ChipView }> = [
  { name: "Checking out", view: { kind: "checking-out", host: "Linux VM", commits: 3 } },
  {
    name: "Ready",
    view: { kind: "ready", host: "Linux VM", at: "4f2c1a9", command: "bun run dev" },
  },
  {
    name: "Running",
    view: { kind: "running", host: "Linux VM", command: "bun run dev", seconds: 130 },
  },
  {
    name: "New commits",
    view: {
      kind: "new-commits",
      host: "Linux VM",
      at: "4f2c1a9",
      latest: "9e07b3c",
      count: 2,
      rewritten: false,
    },
  },
  {
    name: "Force-pushed",
    view: {
      kind: "new-commits",
      host: "Linux VM",
      at: "4f2c1a9",
      latest: "9e07b3c",
      count: 3,
      rewritten: true,
    },
  },
  { name: "Updating", view: { kind: "updating", host: "Linux VM", to: "9e07b3c" } },
  {
    name: "Host reconnecting",
    view: { kind: "reconnecting", host: "Linux VM", at: "4f2c1a9", seconds: 40 },
  },
  { name: "Host offline", view: { kind: "offline", host: "Linux VM", next: "Mac Studio" } },
  {
    name: "Failed",
    view: { kind: "blocked", host: "Linux VM", block: blockView(failed, "Linux VM") },
  },
  {
    name: "Edits block removal",
    view: { kind: "blocked", host: "Linux VM", block: blockView(dirty, "Linux VM") },
  },
  { name: "Removing", view: { kind: "removing", host: "Linux VM" } },
  { name: "Waiting for a host", view: { kind: "waiting", host: "Mac Studio" } },
  { name: "Not on any host", view: { kind: "none" } },
  { name: "Cloning", view: { kind: "cloning", host: "Linux VM" } },
  {
    name: "Clone failed",
    view: {
      kind: "clone-failed",
      host: "Linux VM",
      message: "git clone exited with code 128; its output is in the terminal",
    },
  },
  { name: "Removed", view: { kind: "removed", host: "Linux VM", reason: "merged" } },
];

const CHOICES: ReadonlyArray<HostChoice> = [
  {
    hostKey: "vm",
    workspaceId: "w1",
    label: "Linux VM",
    caption: "last used · nj-homes",
    trailing: "18 ms",
    current: true,
    enabled: true,
  },
  {
    hostKey: "studio",
    workspaceId: "w2",
    label: "Mac Studio",
    caption: "nj-homes-choice",
    trailing: "4 ms",
    current: false,
    enabled: true,
  },
  {
    hostKey: "local",
    workspaceId: "w3",
    label: "MacBook Pro",
    caption: "this Mac · nj-homes",
    trailing: "local",
    current: false,
    enabled: true,
  },
];

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const COMPARE: CompareView = {
  status: "ahead",
  total: 2,
  commits: [
    { oid: "9e07b3c41", headline: "Handle zero-member households", date: minutesAgo(4) },
    { oid: "c41d2a990", headline: "Rename limit helper", date: minutesAgo(6) },
  ],
};

const model = (
  view: ChipView,
  held: Held | null,
  patch: Partial<CheckoutModel> = {}
): CheckoutModel => ({
  view,
  held,
  choices: CHOICES,
  detail: null,
  nextPlace: null,
  command: { kind: "found", command: "bun run dev" },
  newCommits: null,
  cloneTargets: [
    { hostKey: "vm", label: "Linux VM", homeDir: "/home/lucas" },
    { hostKey: "studio", label: "Mac Studio", homeDir: "/Users/lucas" },
  ],
  clone: null,
  home: "/home/lucas",
  ...patch,
});

const held = (patch: Partial<ReviewCheckout> = {}): Held => ({
  hostKey: "vm",
  hostLabel: "Linux VM",
  checkout: checkout(patch),
});

/** One chip with its menu open, per scene. */
export const MENUS = new Map<string, CheckoutModel>([
  [
    "menu-new-commits",
    model(
      {
        kind: "new-commits",
        host: "Linux VM",
        at: "4f2c1a9",
        latest: "9e07b3c",
        count: 2,
        rewritten: false,
      },
      held({ state: "stale", latestHead: "9e07b3c41" }),
      { newCommits: COMPARE }
    ),
  ],
  [
    "menu-running",
    model({ kind: "running", host: "Linux VM", command: "bun run dev", seconds: 130 }, held()),
  ],
  [
    "menu-failed",
    model(
      { kind: "blocked", host: "Linux VM", block: blockView(failed, "Linux VM") },
      held({ state: "blocked", blocked: failed, head: null })
    ),
  ],
  ["menu-clone", model({ kind: "none" }, null)],
]);
