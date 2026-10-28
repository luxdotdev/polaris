/**
 * Hands the widgets' snapshot to the WidgetKit extension: JSON in the App Group's defaults,
 * then a timeline reload, only when what the widgets show has changed.
 */
import type { WidgetSnapshot } from "./snapshot.ts";

/** Also in app.json's entitlements and `targets/widgets/Snapshot.swift`. */
export const APP_GROUP = "group.dev.lux.polaris";

export const SNAPSHOT_KEY = "polaris.widgets.snapshot";

/** The App Group as the publisher writes it; `ExtensionStorage` on iOS, a fake in tests. */
export interface WidgetStore {
  readonly write: (json: string) => void;
  /** Asks WidgetKit to read the snapshot again. */
  readonly reload: () => void;
}

export interface WidgetPublisher {
  readonly publish: (snapshot: WidgetSnapshot) => void;
  /** Reloads the timelines from what was last written, e.g. after a push wake (R5). */
  readonly refresh: () => void;
}

/**
 * `writtenAt` (ms) rides beside the snapshot so the extension can tell which needs you pushes
 * arrived after it (R5's `polaris.push.recent`); it doesn't count as a change.
 */
export const widgetPublisher = (store: WidgetStore, now = Date.now): WidgetPublisher => {
  let written: string | null = null;

  return {
    publish: (snapshot) => {
      const json = JSON.stringify(snapshot);

      if (json === written) return;
      store.write(JSON.stringify({ ...snapshot, writtenAt: now() }));
      written = json;
      store.reload();
    },
    refresh: () => store.reload(),
  };
};
