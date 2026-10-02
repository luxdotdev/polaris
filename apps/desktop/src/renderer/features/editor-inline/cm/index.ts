/** The inline card's CodeMirror side, as one extension per editor view. */
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { acceptOpenProposal } from "../actions.ts";
import { cardDecorations } from "./decorations.ts";
import "./inline.css";
import { type InlineFile, inlineFile, layerPlugin } from "./layer.ts";
import { dropCard } from "../store.ts";
import { cardField, cardOf } from "./state.ts";

export { cardOf };

/** A card that leaves the state any other way (the tab closes, the file reloads) ends its session. */
const sessionCleanup = [
  EditorView.updateListener.of((update) => {
    const before = cardOf(update.startState);

    if (before !== null && cardOf(update.state)?.id !== before.id) dropCard(before.id);
  }),
  ViewPlugin.define((view) => ({
    destroy: () => {
      const card = cardOf(view.state);

      if (card !== null) dropCard(card.id);
    },
  })),
];

export const inlineExtensions = (file: InlineFile): Extension => [
  inlineFile.of(file),
  cardField,
  cardDecorations,
  layerPlugin,
  sessionCleanup,
  // ⌘↵ accepts a showing proposal from the text too; otherwise it falls through.
  Prec.highest(keymap.of([{ key: "Mod-Enter", run: acceptOpenProposal }])),
];

export { cardHosts } from "./decorations.ts";

export { type BarPlace, type CardLines, type InlineFile, layers, type ViewLayer } from "./layer.ts";
