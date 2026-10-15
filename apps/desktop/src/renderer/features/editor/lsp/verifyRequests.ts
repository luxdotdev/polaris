/**
 * How the verifier reads a document's errors: a pull report when the server has one, else
 * tsserver's synchronous checks through typescript-language-server. Its pushes are not used: the
 * first can hold only syntax errors, and nothing marks the last (docs/research/next-edit-spike.md).
 */
import type { Text } from "@codemirror/state";
import type { BufferDiagnostic } from "@polaris/predict";
import * as P from "@polaris/protocol";
import { Match, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";
import * as Payload from "./payloads.ts";
import { offsetAt } from "./position.ts";
import type { LanguageProvider } from "./types.ts";

/** A diagnostic as the verifier compares it, with the range the server sent. */
export interface Located extends BufferDiagnostic {
  readonly range: typeof P.LanguageRange.Type;
}

type Documents = typeof P.LanguageRequestFence.Type.documents;

type Encoding = LanguageProvider["capabilities"]["positionEncoding"];

export type DiagnosticsRead = (
  provider: LanguageProvider,
  documents: Documents,
  uri: string,
  doc: Text,
  signal: AbortSignal
) => Promise<Located[]>;

export const TSSERVER_REQUEST = "typescript.tsserverRequest";

/** Generous: the caller's deadline decides, and an abort cancels the request on the Host. */
const REQUEST_MS = 30_000;

const TsDiagnostics = Schema.Struct({
  success: Schema.Literal(true),
  body: Schema.Array(
    Schema.Struct({
      start: Schema.Struct({ line: Schema.Int, offset: Schema.Int }),
      end: Schema.Struct({ line: Schema.Int, offset: Schema.Int }),
      text: Schema.String,
      code: Schema.optionalKey(Schema.Int),
      category: Schema.String,
    })
  ).check(Schema.isMaxLength(2000)),
});

let serial = 0;

const requestId = () => {
  serial += 1;

  return `verify-${serial}`;
};

/** One fenced request on the shadow's acknowledgment; rejects on failure or abort. */
const send = async (
  api: LanguageApi,
  provider: LanguageProvider,
  documents: Documents,
  method: typeof P.LanguageFeatureMethod.Type,
  params: typeof P.LanguageJsonObject.Type,
  signal: AbortSignal
) => {
  const request = P.LanguageFeatureRequest.make({
    requestId: requestId(),
    fence: {
      context: provider.context,
      requiredSequence: provider.ack.acceptedSequence,
      documents,
    },
    method,
    params,
    deadline: Date.now() + REQUEST_MS,
  });

  let abort = () => {};

  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      void api
        .request("languages.cancel", {
          hostKey: provider.hostKey,
          context: provider.context,
          requestId: request.requestId,
        })
        .catch(() => undefined);
      reject(new Error("Verification cancelled."));
    };

    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });

  try {
    const answer = await Promise.race([
      api.request("languages.request", { hostKey: provider.hostKey, ...request }),
      aborted,
    ]);

    if (!answer.ok) throw languageIpcError(answer.error);

    return Schema.decodeUnknownSync(P.LanguageFeatureResult)(answer.value).result;
  } finally {
    signal.removeEventListener("abort", abort);
  }
};

const placed = (doc: Text, position: typeof P.LanguagePosition.Type, encoding: Encoding) => {
  try {
    return offsetAt(doc, position, encoding);
  } catch {
    return Math.min(doc.length, doc.line(Math.min(doc.lines, Math.max(1, position.line + 1))).from);
  }
};

const located = (
  doc: Text,
  range: typeof P.LanguageRange.Type,
  encoding: Encoding,
  rest: Omit<BufferDiagnostic, "from" | "to">
): Located => ({
  ...rest,
  range,
  from: placed(doc, range.start, encoding),
  to: placed(doc, range.end, encoding),
});

const lspSeverity = (severity: 1 | 2 | 3 | 4 | undefined): BufferDiagnostic["severity"] =>
  Match.value(severity).pipe(
    Match.when(1, () => "error" as const),
    Match.when(2, () => "warning" as const),
    Match.when(4, () => "hint" as const),
    Match.orElse(() => "information" as const)
  );

const tsSeverity = (category: string): BufferDiagnostic["severity"] =>
  Match.value(category).pipe(
    Match.when("error", () => "error" as const),
    Match.when("warning", () => "warning" as const),
    Match.when("suggestion", () => "hint" as const),
    Match.orElse(() => "information" as const)
  );

const pull =
  (api: LanguageApi): DiagnosticsRead =>
  async (provider, documents, uri, doc, signal) => {
    const result = await send(
      api,
      provider,
      documents,
      "textDocument/diagnostic",
      { textDocument: { uri } },
      signal
    );

    const report = Schema.decodeUnknownSync(Payload.PullDiagnostic)(result);

    if (report.kind !== "full") throw new Error("Expected a full diagnostic report.");

    return report.items.map((item) =>
      located(doc, item.range, provider.capabilities.positionEncoding, {
        severity: lspSeverity(item.severity),
        code: String(item.code ?? ""),
        message: item.message,
      })
    );
  };

const filePath = (uri: string) => decodeURIComponent(new URL(uri).pathname);

const tsserver =
  (api: LanguageApi): DiagnosticsRead =>
  async (provider, documents, uri, doc, signal) => {
    const check = async (command: string) => {
      const result = await send(
        api,
        provider,
        documents,
        "workspace/executeCommand",
        { command: TSSERVER_REQUEST, arguments: [command, { file: filePath(uri) }] },
        signal
      );

      return Schema.decodeUnknownSync(TsDiagnostics)(result).body;
    };

    const sets = await Promise.all([
      check("syntacticDiagnosticsSync"),
      check("semanticDiagnosticsSync"),
    ]);

    return sets.flat().map((item) =>
      located(
        doc,
        {
          start: { line: item.start.line - 1, character: item.start.offset - 1 },
          end: { line: item.end.line - 1, character: item.end.offset - 1 },
        },
        "utf-16",
        { severity: tsSeverity(item.category), code: String(item.code ?? ""), message: item.text }
      )
    );
  };

const pulls = (provider: LanguageProvider) =>
  (provider.capabilities.diagnostics === "pull" ||
    provider.capabilities.diagnostics === "push-and-pull") &&
  provider.capabilities.methods.includes("textDocument/diagnostic");

/** How this provider's errors can be read for a shadow, or null when it has no complete answer. */
export const diagnosticsReader = (
  api: LanguageApi,
  provider: LanguageProvider
): DiagnosticsRead | null => {
  if (pulls(provider)) return pull(api);

  return provider.capabilities.executeCommands.includes(TSSERVER_REQUEST) ? tsserver(api) : null;
};
