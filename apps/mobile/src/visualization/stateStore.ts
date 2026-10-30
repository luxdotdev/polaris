/**
 * Each Visualization's `pv.state`, on this phone only (ADR 0089), as JSON in the document
 * directory, keyed by Visualization id; read synchronously so a frame's document carries it.
 */
import type { FrameMessage } from "@polaris/visualization";
import { Option, Schema } from "effect";
import { Directory, File, Paths } from "expo-file-system";

/** The frame's opaque envelope, stored as it sent it and handed back as `options.state`. */
export type SavedState = Extract<FrameMessage, { readonly type: "pv:state" }>["state"];

export interface VisualizationStateStore {
  /** The saved state, or undefined when there is none. */
  readonly read: (id: string) => SavedState;
  readonly write: (id: string, state: SavedState) => void;
}

const directory = () => new Directory(Paths.document, "visualizations");

/** Ids are the Daemon's `viz_<uuid>`; anything else is made filename-safe. */
const fileOf = (id: string) =>
  new File(directory(), `${id.replaceAll(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)}.json`);

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export const fileStateStore: VisualizationStateStore = {
  read: (id) => {
    try {
      const file = fileOf(id);

      return file.exists ? Option.getOrUndefined(decode(file.textSync())) : undefined;
    } catch {
      return undefined;
    }
  },
  write: (id, state) => {
    try {
      const folder = directory();

      if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
      fileOf(id).writeSync(JSON.stringify(state));
    } catch {
      // Best effort: the frame keeps its state for as long as it's open either way.
    }
  },
};
