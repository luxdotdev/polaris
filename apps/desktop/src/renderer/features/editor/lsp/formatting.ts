import * as P from "@polaris/protocol";
import { Match } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { EditorFile } from "../api.ts";
import * as formats from "../formatting/bridge.ts";
import { formattedText } from "../formatting/edits.ts";
import type { FormatSnapshot } from "../formatting/index.ts";
import { formatRoute, formatWithProject } from "../formatting/project.ts";
import type { LanguageFeatures } from "./features.ts";
import { providerFence } from "./requests.ts";
import { bufferText, type LanguageBuffer } from "./types.ts";

export interface EntryFormatting {
  readonly file: EditorFile;
  readonly api: LanguageApi;
  readonly checkout: P.LanguageCheckout;
  readonly found: typeof P.LanguageDiscovery.Type;
  readonly features: LanguageFeatures;
  /** Every provider group serving the file is ready. */
  readonly ready: () => Promise<void>;
  readonly read: () => LanguageBuffer;
  readonly revision: () => number;
  readonly current: () => boolean;
  /** The Workspace's name, for "once you trust …". */
  readonly workspace: () => string;
}

/** The language server's `textDocument/formatting`, applied to the snapshot's text. */
const formatWithServer = async (
  input: EntryFormatting,
  snapshot: FormatSnapshot,
  formatter: P.LanguageFormatterSelection,
  signal: AbortSignal
) => {
  const provider = formats.formattingProvider(formatter, input.features.options.providers());

  if (provider === null || snapshot.diskVersion === null) return snapshot.text;
  const buffer = input.read();

  const outcome = await input.features.format(
    provider,
    P.LanguageFormatPreflight.make({
      requestId: `format-${crypto.randomUUID()}`,
      fence: providerFence(provider, buffer),
      document: { uri: buffer.uri, version: buffer.version },
      snapshot: snapshot.text,
      expectedDiskVersion: snapshot.diskVersion,
      ...formats.formatterRequest(formatter, provider.context.providerId, snapshot.indent),
      reason: snapshot.reason,
      deadline: Date.now() + 5000,
    }),
    signal
  );

  return Match.value(outcome).pipe(
    Match.tag("Formatted", (value) =>
      formattedText(snapshot.text, value.edits, provider.capabilities.positionEncoding)
    ),
    Match.tag("Skipped", () => snapshot.text),
    Match.tag("Failed", (value) => {
      throw new Error(value.message);
    }),
    Match.exhaustive
  );
};

/** Binds an open file's formatter: Settings' choice, else the project's own, else its server's. */
export const bindEntryFormatter = (input: EntryFormatting) => {
  const settings = input.found.effectiveSettings;
  const project = input.found.projectFormatter;

  return formats.bindFormatter(input.file, {
    canFormat: () =>
      formatRoute(settings.formatter, project) === "project" ||
      formats.formatsDocuments(input.features.options.providers()),
    settings: async () => ({
      formatOnSave: settings.formatOnSave,
      formatter: settings.formatter,
    }),
    format: async (snapshot, formatter, signal) => {
      await input.ready();

      if (
        signal.aborted ||
        !input.current() ||
        snapshot.diskVersion === null ||
        snapshot.version !== input.revision() ||
        snapshot.text !== bufferText(input.read())
      )
        throw new Error("Formatter document changed.");
      const route = formatRoute(formatter, project);

      if (route === "ignored") return snapshot.text;

      if (route === "server" || project === undefined || project === null)
        return formatWithServer(input, snapshot, formatter, signal);

      return formatWithProject(
        input.api,
        {
          hostKey: input.file.hostKey,
          checkout: input.checkout,
          path: input.file.path,
          tool: project.tool,
          workspace: input.workspace(),
        },
        snapshot,
        signal
      );
    },
  });
};
