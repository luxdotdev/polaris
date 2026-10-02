import { LspFramer, encodeFrame } from "../transport/framing.ts";
import { Schema } from "effect";
import { LanguageJsonRpcRequest } from "@polaris/protocol";

const mode = process.argv[2] ?? "ordinary";

const decoder = new LspFramer();

const documents = new Map<string, { text: string; version: number }>();

const received: string[] = [];

const send = (value: Parameters<typeof encodeFrame>[0]) => process.stdout.write(encodeFrame(value));

let configuration: unknown;

const Doc = Schema.Struct({
  textDocument: Schema.Struct({
    uri: Schema.String,
    text: Schema.optionalKey(Schema.String),
    version: Schema.optionalKey(Schema.Int),
  }),
  contentChanges: Schema.optionalKey(Schema.Array(Schema.Struct({ text: Schema.String }))),
});

for await (const chunk of Bun.stdin.stream()) {
  for (const message of decoder.push(chunk)) {
    if (!("method" in message)) {
      if ("result" in message) configuration = message.result;
      continue;
    }

    const method = message.method;
    received.push(method);

    if (method === "initialize" && Schema.is(LanguageJsonRpcRequest)(message)) {
      if (mode === "malformed") {
        process.stdout.write("Content-Length: -1\r\n\r\n");
        continue;
      }

      if (mode === "crash-init") process.exit(2);
      send({
        jsonrpc: "2.0",
        id: "config",
        method: "workspace/configuration",
        params: { items: [{ section: "nested.value" }, { section: "missing" }] },
      });

      if (mode === "slow-init") await Bun.sleep(40);
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          capabilities: {
            positionEncoding: "utf-16",
            textDocumentSync: { openClose: true, change: 1, save: { includeText: true } },
            completionProvider: { resolveProvider: true },
            hoverProvider: true,
            documentFormattingProvider: true,
            diagnosticProvider: { workspaceDiagnostics: true },
            executeCommandProvider: { commands: ["test"] },
          },
        },
      });
    }

    if (method === "textDocument/didOpen" || method === "textDocument/didChange") {
      const doc = Schema.decodeUnknownSync(Doc)(message.params);
      documents.set(doc.textDocument.uri, {
        text: doc.textDocument.text ?? doc.contentChanges?.[0]?.text ?? "",
        version: doc.textDocument.version ?? 0,
      });

      if (mode === "crash-open") process.exit(2);
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri: doc.textDocument.uri,
          version: doc.textDocument.version ?? 0,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              message: "fixture",
              severity: 2,
            },
          ],
        },
      });
    }

    if (method === "textDocument/didClose") {
      const doc = Schema.decodeUnknownSync(Doc)(message.params);
      documents.delete(doc.textDocument.uri);
    }

    if (method === "textDocument/hover" && Schema.is(LanguageJsonRpcRequest)(message)) {
      const params = Schema.decodeUnknownSync(
        Schema.Struct({
          textDocument: Schema.Struct({ uri: Schema.String }),
          slow: Schema.optionalKey(Schema.Boolean),
        })
      )(message.params);

      if (params.slow) await Bun.sleep(60);
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          ...documents.get(params.textDocument.uri),
          received,
          configuration: Schema.decodeUnknownSync(Schema.Json)(configuration ?? null),
        },
      });
    }

    if (method === "textDocument/diagnostic" && Schema.is(LanguageJsonRpcRequest)(message))
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { kind: "full", resultId: "one", items: [] },
      });

    if (method === "textDocument/formatting" && Schema.is(LanguageJsonRpcRequest)(message))
      send({ jsonrpc: "2.0", id: message.id, result: [] });

    if (method === "shutdown" && Schema.is(LanguageJsonRpcRequest)(message)) {
      if (mode === "slow-shutdown") await Bun.sleep(60);
      send({ jsonrpc: "2.0", id: message.id, result: null });
    }

    if (method === "exit") process.exit(0);
  }
}
