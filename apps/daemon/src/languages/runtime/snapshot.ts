import { LanguageContextSnapshot } from "@polaris/protocol";
import { limits, type Entry } from "./types.ts";

export const snapshot = (entry: Entry) =>
  LanguageContextSnapshot.make({
    context: entry.identity,
    runtime: entry.runtime,
    ack: entry.documents.ack(),
    limits,
  });
