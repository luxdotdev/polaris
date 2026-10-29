/**
 * The completion card as an instrument card (DESIGN.md, Menus and popovers; Paper X-F 10): the
 * header's state word and host switch, the readout, the hero's parts and the footer's line.
 */
import { Match } from "effect";
import type { Fact } from "../../status/model.ts";
import { modelName } from "../store.ts";
import { type CardAction, type CardKind, capitalized, type CompletionCardView } from "./model.ts";

/** The header's mono state word after "Tab completion". */
export const stateWord = (view: CompletionCardView): string =>
  Match.value(view.kind).pipe(
    Match.when("downloading", () =>
      view.progress === null ? "Downloading" : `Downloading ${Math.floor(view.progress * 100)}%`
    ),
    Match.orElse((kind) => STATES[kind])
  );

const STATES: Record<Exclude<CardKind, "downloading">, string> = {
  offline: "Offline",
  reconnecting: "Reconnecting",
  offer: "Off",
  off: "Off",
  "off-host": "Off",
  finding: "Finding…",
  setup: "Not set up",
  loading: "Loading",
  "setup-failed": "Setup failed",
  "no-server": "No model server",
  failed: "Not answering",
  ready: "Ready",
  serving: "Serving",
};

export interface HostSwitch {
  readonly on: boolean;
  /** "On for Mac Studio". */
  readonly label: string;
  readonly action: CardAction;
}

const SWITCHES = new Set<CardAction["id"]>(["turn-on-host", "turn-off-host"]);

/** Turning completion on or off for this Host is the header's switch, never a footer action. */
export const hostSwitch = (view: CompletionCardView): HostSwitch | null => {
  const action = view.actions.find((item) => SWITCHES.has(item.id));

  if (action === undefined) return null;
  const on = action.id === "turn-off-host";

  return { on, label: `${on ? "On" : "Off"} for ${view.host}`, action };
};

export interface FooterActions {
  /** The footer's one button: Check again where the card offers it (Paper X-F 10). */
  readonly primary: CardAction | null;
  /** The rest as quiet links under the status line, Settings last. */
  readonly links: ReadonlyArray<CardAction>;
}

export const footerActions = (view: CompletionCardView): FooterActions => {
  const rest = view.actions.filter((action) => !SWITCHES.has(action.id));

  const primary =
    rest.find((action) => action.id === "check-again") ??
    rest.find((action) => action.id !== "settings") ??
    null;

  return { primary, links: rest.filter((action) => action !== primary) };
};

const READOUT = new Set(["Accepted", "Shown", "Undone"]);

/** The hero and the footer already say the model, the machine and the endpoint. */
const SHOWN_ELSEWHERE = new Set(["Model", "Runs on", "Endpoint"]);

/** The readout well's cells (Accepted, Shown, Undone), then the facts the card still lists. */
export const readout = (facts: ReadonlyArray<Fact>) => ({
  cells: facts.filter((fact) => READOUT.has(fact.label)),
  details: facts.filter((fact) => !READOUT.has(fact.label) && !SHOWN_ELSEWHERE.has(fact.label)),
});

export interface Hero {
  /** The serving machine as a label ("Mac Studio"). */
  readonly machine: string;
  /** host:port of the model server. */
  readonly endpoint: string;
  /** False once the last completion failed: the picture shows no answer. */
  readonly answering: boolean;
}

/** Keystrokes out to the model server and a suggestion back, while there is a server to draw. */
export const heroOf = (view: CompletionCardView): Hero | null => {
  if (view.target === null) return null;

  return {
    machine: capitalized(view.target.machine),
    endpoint: new URL(view.target.endpoint.url).host,
    answering: view.kind !== "failed",
  };
};

/** The footer's mono line: what serves ("Sweep Next-Edit 1.5B · Mac Studio · llama-server"). */
export const footerStatus = (view: CompletionCardView): string => {
  const target = view.target;

  if (target === null) return view.label;

  if (view.kind === "failed") return `No answer · ${capitalized(target.machine)}`;
  const server = view.facts.find((fact) => fact.label === "Endpoint")?.note;

  return [modelName(target.model), capitalized(target.machine), server]
    .filter((part) => part !== undefined)
    .join(" · ");
};
