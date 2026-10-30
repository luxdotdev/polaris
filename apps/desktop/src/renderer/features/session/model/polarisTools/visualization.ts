/**
 * A `visualize` call as the conversation shows it (DESIGN.md, Visualizations): drawing while
 * it runs, then the Visualization in its frame. A call Polaris refused keeps its Polaris row.
 */
import { VisualizeResult } from "@polaris/visualization";
import type { TurnView } from "../../../../store/sessionModel.ts";
import { Option, Predicate, Schema } from "effect";
import { polarisTool } from "../runs.ts";
import { outputText } from "./result.ts";
import type { Built, ToolCallItem } from "./types.ts";

/** Loose like the other inputs: a streaming call may not have its title yet. */
const Input = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  html: Schema.optionalKey(Schema.String),
  replaces: Schema.optionalKey(Schema.String),
});

export type VisualizationView =
  | { readonly phase: "drawing"; readonly title: string }
  | {
      readonly phase: "shown";
      /** Polaris's id for it (`viz_…`): what a later call's `replaces` names. */
      readonly id: string;
      readonly title: string;
      readonly html: string;
      readonly replaces: string | null;
    };

const decodeInput = Schema.decodeUnknownOption(Input);

const decodeResult = Schema.decodeUnknownOption(Schema.fromJsonString(VisualizeResult));

export const isVisualize = (name: string) => polarisTool(name) === "visualize";

/** The Visualization a call drew; null for any other call, or one that didn't draw. */
export const visualizationView = (item: ToolCallItem): VisualizationView | null => {
  if (!isVisualize(item.name)) return null;
  const input: typeof Input.Type = Option.getOrElse(decodeInput(item.input), () => ({}));
  const title = input.title ?? "";

  if (item.status === "running") return { phase: "drawing", title };

  if (item.status !== "completed" || input.html === undefined) return null;

  return Option.match(decodeResult(outputText(item).trim()), {
    onNone: () => null,
    onSome: (result) => ({
      phase: "shown",
      id: result.id,
      title: result.title,
      html: input.html ?? "",
      replaces: input.replaces ?? null,
    }),
  });
};

/** The one place a Visualization is matched to the one it revises: `replaces` names its id. */
export const revisedBy = (earlier: VisualizationView, later: VisualizationView): boolean =>
  earlier.phase === "shown" && later.phase === "shown" && later.replaces === earlier.id;

const shownCache = new WeakMap<TurnView, ReadonlyArray<VisualizationView>>();

const shownIn = (view: TurnView): ReadonlyArray<VisualizationView> => {
  const hit = shownCache.get(view);

  if (hit !== undefined) return hit;

  const shown = view.items.flatMap((item) => {
    if (!Predicate.isTagged(item, "ToolCall")) return [];
    const drawn = visualizationView(item);

    return drawn?.phase === "shown" ? [drawn] : [];
  });

  shownCache.set(view, shown);

  return shown;
};

/** The ids of the session's Visualizations a later one revised; they collapse to "Revised below". */
export const revisedIds = (turns: ReadonlyArray<TurnView>): ReadonlySet<string> => {
  const shown = turns.flatMap(shownIn);

  return new Set(
    shown.flatMap((earlier, n) =>
      earlier.phase === "shown" && shown.slice(n + 1).some((later) => revisedBy(earlier, later))
        ? [earlier.id]
        : []
    )
  );
};

/** A refused or failed call's Polaris row. */
export const visualize = ({ title = "" }: typeof Input.Type): Built => ({
  head: {
    verbs: ["Drawing a visualization", "Drew a visualization", "draw a visualization"],
    subject: title === "" ? null : { text: title },
    detail: [],
    caption: null,
  },
  well: null,
  links: [],
});

export const VisualizeInput = Input;
