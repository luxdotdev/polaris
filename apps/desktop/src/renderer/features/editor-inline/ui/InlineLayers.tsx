/**
 * Mounted once in the app: portals each editor view's selection bar into its layer and each
 * open card into its block widget, so both live in the app's React tree (its stores, the
 * Harness picker, toasts). Also the ⌘L picker.
 */
import type { EditorView } from "@codemirror/view";
import type { Worktree } from "@polaris/protocol";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { hasCapability, useHost } from "../../session/hooks.ts";
import { closeInlineCard, openInlineCard } from "../actions.ts";
import { cardHosts, layers, type ViewLayer } from "../cm/index.ts";
import { openAsSession } from "../data/openAsSession.ts";
import type { CardSession } from "../model/card.ts";
import { AddToSession, addSelectionToSession } from "./AddToSession.tsx";
import { Card } from "./Card.tsx";
import { SelectionBar } from "./SelectionBar.tsx";

const keys = new WeakMap<EditorView, number>();

let nextKey = 0;

const keyOf = (view: EditorView) => {
  let key = keys.get(view);

  if (key === undefined) {
    nextKey += 1;
    key = nextKey;
    keys.set(view, key);
  }

  return key;
};

/** The non-main Worktree holding `path`, for a session started from the card. */
const worktreeOf = (worktrees: ReadonlyMap<string, Worktree> | undefined, path: string) =>
  [...(worktrees?.values() ?? [])].find((w) => !w.isMain && path.startsWith(`${w.path}/`))?.path ??
  null;

const CardPortal = ({ layer, host }: { readonly layer: ViewLayer; readonly host: HTMLElement }) => {
  const { file, card, view } = layer;
  const hostView = useHost(file?.hostKey ?? "");

  const worktrees = useApp((s) =>
    file === null ? undefined : s.hostModels[file.hostKey]?.worktrees
  );

  const { selectSession } = useShellActions();

  if (file === null || card === null) return null;

  const onOpenAsSession = (session: CardSession) => {
    const { phase } = session;
    const request = phase.kind === "draft" ? null : phase.request;

    if (request === null) return;
    const patch = phase.kind === "proposed" ? phase.patch : null;

    void openAsSession(file.hostKey, request, patch, worktreeOf(worktrees, file.path)).then(
      (sessionId) => {
        if (sessionId === null) return;
        closeInlineCard(view, card.id);
        selectSession({ hostKey: file.hostKey, sessionId });
      }
    );
  };

  return createPortal(
    <Card
      view={view}
      id={card.id}
      hostKey={file.hostKey}
      lines={card}
      unsupported={
        hasCapability(hostView, "inline.propose")
          ? null
          : "This host's daemon is too old to edit inline. Upgrade it in Settings → Hosts."
      }
      onOpenAsSession={onOpenAsSession}
    />,
    host
  );
};

const Layer = ({ layer }: { readonly layer: ViewLayer }) => {
  const host = useStore(cardHosts, (s) => (layer.card === null ? undefined : s[layer.card.id]));
  const { file, bar, view } = layer;

  return (
    <>
      {bar === null || file === null
        ? null
        : createPortal(
            <SelectionBar
              place={bar}
              onAsk={() => openInlineCard(view)}
              onAdd={() => addSelectionToSession(view.state, file)}
            />,
            layer.dom
          )}
      {host === undefined ? null : <CardPortal layer={layer} host={host} />}
    </>
  );
};

export const InlineLayers = () => {
  const all = useStore(layers);

  return (
    <>
      {all.map((layer) => (
        <Layer key={keyOf(layer.view)} layer={layer} />
      ))}
      <AddToSession />
    </>
  );
};
