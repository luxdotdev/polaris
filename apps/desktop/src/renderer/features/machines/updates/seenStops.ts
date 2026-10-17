/**
 * Which Daemon stop each Host's note was seen for (`DaemonStop.at`), kept across launches:
 * the new Daemon repeats `previousStop` in every `hello`, and the note shows once.
 */
import { Option, Schema } from "effect";

const KEY = "polaris.daemon-stops.seen";

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
);

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readSeenStops = (): Readonly<Record<string, string>> => {
  try {
    const raw = storage()?.getItem(KEY) ?? null;

    return raw === null ? {} : Option.getOrElse(decode(raw), () => ({}));
  } catch {
    return {};
  }
};

export const writeSeenStops = (seen: Readonly<Record<string, string>>) => {
  try {
    storage()?.setItem(KEY, JSON.stringify(seen));
  } catch {
    // A private window or full storage: the note shows again next launch.
  }
};
