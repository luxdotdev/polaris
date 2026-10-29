import { expect, test } from "bun:test";
import { DEFAULT_PREDICTION_PREFERENCES } from "../../../../../shared/predictionPlacement.ts";
import { BASE, METRICS, SERVED } from "./fixtures.ts";
import {
  footerActions,
  footerStatus,
  heroOf,
  hostSwitch,
  readout,
  stateWord,
} from "./instrument.ts";
import { completionCard, type CardInput } from "./model.ts";

const card = (patch: Partial<CardInput> = {}) => completionCard({ ...BASE, ...patch });

test("Turning off for the host is the header's switch, and Check again the footer's one button", () => {
  const view = card({ result: SERVED });

  expect(hostSwitch(view)).toMatchObject({ on: true, label: "On for Pi 4" });

  const { primary, links } = footerActions(view);

  expect(primary?.id).toBe("check-again");
  expect(links.map((link) => link.id)).not.toContain("turn-off-host");
  expect(links.at(-1)?.id).toBe("settings");
});

test("Off for this host, the switch turns it back on and the footer keeps only Settings", () => {
  const off = { ...DEFAULT_PREDICTION_PREFERENCES, placement: "off" as const };
  const view = card({ preferences: off });

  expect(hostSwitch(view)).toMatchObject({ on: false, label: "Off for Pi 4" });
  expect(hostSwitch(view)?.action.id).toBe("turn-on-host");
  expect(footerActions(view)).toMatchObject({ primary: null, links: [{ id: "settings" }] });
});

test("Turned off everywhere, there is no host switch and turning on is the footer's button", () => {
  const view = card({ enabled: false });

  expect(hostSwitch(view)).toBeNull();
  expect(footerActions(view).primary?.id).toBe("turn-on");
});

test("A failed completion reads Not answering, with no answer drawn and named in the footer", () => {
  const view = card({ result: SERVED, failure: "connect ECONNREFUSED 127.0.0.1:8080" });

  expect(stateWord(view)).toBe("Not answering");
  expect(heroOf(view)).toEqual({
    machine: "This Mac",
    endpoint: "127.0.0.1:8080",
    answering: false,
  });
  expect(footerStatus(view)).toBe("No answer · This Mac");
});

test("Serving, the footer names the model, machine and server, and the readout takes the counts", () => {
  const view = card({ result: SERVED, metrics: METRICS });

  expect(footerStatus(view)).toBe("Mellum2 · This Mac · llama-server");

  const { cells, details } = readout(view.facts);

  expect(cells.map((cell) => cell.label)).toEqual(["Accepted", "Shown", "Undone"]);
  expect(details.map((fact) => fact.label)).toEqual(["Latency", "Context"]);
});

test("A download shows its share in the header", () => {
  const view = { ...card(), kind: "downloading" as const, progress: 0.326 };

  expect(stateWord(view)).toBe("Downloading 32%");
});
