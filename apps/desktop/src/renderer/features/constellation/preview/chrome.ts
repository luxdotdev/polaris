/**
 * A real graph: the "Chrome redesign" Constellation (v0.5.0, revision 118) as `status` read
 * it on 2026-10-28, with its parents, groups and gate. The star chart's fixture and preview.
 */
import type { ConstellationRecord } from "../model/index.ts";
import { startedRecord } from "../model/fold.ts";
import { attempt, constellationOf, task } from "./graph.ts";

type Spec = readonly [string, string, ReadonlyArray<string>];

const tasks = [
  task({ id: "F", title: "Foundations", group: "Foundations" }),
  ...[
    ["F1", "Themes: Moonlit, Midnight, light tokens and the choice of dark (ENG-511)"],
    ["F2", "Shell: panels on a ground, the horizon, pill title bar (ENG-512)"],
    ["F3", "Celestials: pixel set, assignment, Working animation (ENG-513)"],
    ["F4", "The live dither field, alive while Working (ENG-514)"],
    ["F5", "Instrument cards, plain menus, popovers that fit (ENG-515)"],
  ].map(([id = "", title = ""]) => task({ id, title, group: "Foundations", parent: "F" })),
  task({ id: "D1", title: "Claude sessions take Claude Code's generated title", group: "Daemon" }),
  task({ id: "V", title: "Views", group: "Views" }),
  ...(
    [
      ["V1", "Conversation: header, turns, composer (ENG-516)", ["F2", "F3", "F4"]],
      ["V2", "Rich popovers as instrument cards (ENG-517)", ["F5", "F3"]],
      ["V3", "Review in the new chrome (ENG-518)", ["F2", "F4", "F5"]],
      ["V4", "Constellation glance as a star chart (ENG-519)", ["F2", "F5"]],
      ["V5", "Editor in the new chrome (ENG-520, ENG-510)", ["F2", "F4", "F5"]],
      ["V6", "Settings in the new chrome (ENG-521)", ["F2", "F5"]],
    ] satisfies ReadonlyArray<Spec>
  ).map(([id, title, deps]) => task({ id, title, deps, group: "Views", parent: "V", ui: true })),
  task({
    id: "Q1",
    title: "Whole-app pass: consistency, themes, densities, performance",
    group: "Release",
    deps: ["V1", "V2", "V3", "V4", "V5", "V6", "D1", "B1", "B2", "B3", "B4"],
  }),
  task({
    id: "G",
    title: "Gate: Polaris 0.5.0 ready",
    kind: "gate",
    group: "Release",
    deps: ["Q1"],
  }),
  task({ id: "B", title: "Break-UI reviews", group: "Resilience" }),
  ...(
    [
      ["B1", "Break-UI pass: shell, Celestials, instrument cards", ["F2", "F3", "F5"]],
      ["B2", "Break-UI pass: conversation and popovers", ["V1", "V2"]],
      ["B3", "Break-UI pass: Review and constellation", ["V3", "V4"]],
      ["B4", "Break-UI pass: Editor and Settings", ["V5", "V6"]],
    ] satisfies ReadonlyArray<Spec>
  ).map(([id, title, deps]) => task({ id, title, deps, group: "Resilience", parent: "B" })),
];

const accepted = ["F1", "F2", "F3", "F4", "F5", "D1"];

const working = ["V3", "V4", "V5", "V6"];

export const chromeTasks = tasks;

export const chromeRecord = (): ConstellationRecord =>
  startedRecord(
    constellationOf({
      name: "Chrome redesign",
      revision: 118,
      tasks,
      attempts: [
        ...accepted.map((taskId, n) =>
          attempt({ taskId, state: "accepted", minutes: 300 - n * 20, mergedHead: `c0ffee${n}` })
        ),
        ...working.map((taskId, n) => attempt({ taskId, state: "working", minutes: 40 - n * 5 })),
      ],
      pendingNotifications: [],
      openQuestions: [],
    }),
    118
  );
