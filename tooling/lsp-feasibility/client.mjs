import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

const root = process.argv[2];

const requireFixture = createRequire(`${root}/package.json`);

const { LSPClient } = await import(pathToFileURL(requireFixture.resolve("@codemirror/lsp-client")));

const sent = [];

let receive;

const client = new LSPClient({
  rootUri: "file:///fixture",
  initializationOptions: { fixture: true },
});

client.connect({
  subscribe(handler) {
    receive = handler;
  },
  unsubscribe() {},
  send(message) {
    const value = JSON.parse(message);
    sent.push(value);

    if (value.method === "initialize")
      queueMicrotask(() =>
        receive(JSON.stringify({ jsonrpc: "2.0", id: value.id, result: { capabilities: {} } }))
      );
  },
});

await client.initializing;

assert.equal(sent[0].params.initializationOptions.fixture, true);

for (const method of [
  "workspace/configuration",
  "client/registerCapability",
  "workspace/applyEdit",
]) {
  receive(JSON.stringify({ jsonrpc: "2.0", id: method, method, params: {} }));
  assert.equal(sent.at(-1).error.code, -32601);
}

client.disconnect();

console.log(
  "CM 6.3.0: initialization passes; configuration/registration/applyEdit each return -32601"
);

const rpc = requireFixture("vscode-jsonrpc/node");

const a = new PassThrough();

const b = new PassThrough();

const broker = rpc.createMessageConnection(
  new rpc.StreamMessageReader(a),
  new rpc.StreamMessageWriter(b)
);

const server = rpc.createMessageConnection(
  new rpc.StreamMessageReader(b),
  new rpc.StreamMessageWriter(a)
);

const capabilities = new Map();

const versions = new Map();

const proposals = [];

broker.onRequest("workspace/configuration", ({ items }) =>
  items.map(({ section }) => ({ section, enabled: true }))
);

broker.onRequest("client/registerCapability", ({ registrations }) => {
  for (const registration of registrations) capabilities.set(registration.id, registration.method);

  return null;
});

broker.onRequest("client/unregisterCapability", ({ unregisterations }) => {
  for (const registration of unregisterations) capabilities.delete(registration.id);

  return null;
});

broker.onRequest("workspace/applyEdit", ({ edit }) => {
  proposals.push(edit);

  return { applied: false, failureReason: "Preview awaiting user acceptance" };
});

server.onNotification("textDocument/didChange", ({ textDocument, contentChanges }) =>
  versions.set(textDocument.uri, { version: textDocument.version, text: contentChanges[0].text })
);

server.onRequest("textDocument/codeAction", () => [
  {
    title: "Fix closed file",
    edit: {
      documentChanges: [
        {
          textDocument: { uri: "file:///fixture/closed.ts", version: null },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "// fixed\n",
            },
          ],
        },
      ],
    },
  },
]);

server.onRequest("textDocument/formatting", async ({ textDocument }) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(versions.get(textDocument.uri).version, 2);

  return [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "// formatted\n",
    },
  ];
});

broker.listen();

server.listen();

try {
  assert.deepEqual(
    await server.sendRequest("workspace/configuration", { items: [{ section: "fixture" }] }),
    [{ section: "fixture", enabled: true }]
  );
  await server.sendRequest("client/registerCapability", {
    registrations: [{ id: "formatter", method: "textDocument/formatting" }],
  });
  assert.equal(capabilities.get("formatter"), "textDocument/formatting");
  const uri = "file:///fixture/open.ts";

  for (const version of [1, 2])
    await broker.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: `unsaved-${version}😀` }],
    });
  const actions = await broker.sendRequest("textDocument/codeAction", {});
  assert.equal(actions[0].edit.documentChanges[0].textDocument.uri, "file:///fixture/closed.ts");
  const outcome = await server.sendRequest("workspace/applyEdit", { edit: actions[0].edit });
  assert.equal(outcome.applied, false);
  assert.equal(proposals.length, 1);
  const edits = await broker.sendRequest("textDocument/formatting", { textDocument: { uri } });
  assert.equal(edits[0].newText, "// formatted\n");
  assert.equal(versions.get(uri).text, "unsaved-2😀");
  await server.sendRequest("client/unregisterCapability", {
    unregisterations: [{ id: "formatter" }],
  });
  assert.equal(capabilities.size, 0);

  const providers = [
    { id: "python.pyright", priority: 0 },
    { id: "python.ruff", priority: 1 },
  ];

  const results = await Promise.all(
    providers.map(async (provider) => ({
      provider: provider.id,
      actions: await broker.sendRequest("textDocument/codeAction", {}),
    }))
  );

  assert.deepEqual(
    results.map((result) => result.provider),
    ["python.pyright", "python.ruff"]
  );
  console.log(
    "JSON-RPC 8.2.1: configuration, register/unregister, ordered unsaved v2, code actions, closed-file proposals, awaitable formatting, labelled provider fan-out PASS"
  );
} finally {
  broker.dispose();
  server.dispose();
  a.destroy();
  b.destroy();
}
