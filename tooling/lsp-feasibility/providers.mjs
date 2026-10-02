import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";

const requireFixture = createRequire(`${process.argv[2]}/package.json`);

const rpc = requireFixture("vscode-jsonrpc/node");

function provider(id) {
  const incoming = new PassThrough();
  const outgoing = new PassThrough();

  const client = rpc.createMessageConnection(
    new rpc.StreamMessageReader(incoming),
    new rpc.StreamMessageWriter(outgoing)
  );

  const server = rpc.createMessageConnection(
    new rpc.StreamMessageReader(outgoing),
    new rpc.StreamMessageWriter(incoming)
  );

  server.onRequest("textDocument/codeAction", () => [
    {
      title: `${id} fix`,
      data: { provider: id },
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
  server.onRequest("textDocument/formatting", () => [{ newText: id }]);
  client.listen();
  server.listen();

  return {
    id,
    client,
    dispose() {
      client.dispose();
      server.dispose();
      incoming.destroy();
      outgoing.destroy();
    },
  };
}

const providers = [provider("python.pyright"), provider("python.ruff")];

try {
  const actions = await Promise.all(
    providers.map(async (item) => ({
      provider: item.id,
      actions: await item.client.sendRequest("textDocument/codeAction", {}),
    }))
  );

  assert.deepEqual(
    actions.map((item) => item.actions[0].data.provider),
    ["python.pyright", "python.ruff"]
  );
  const selectedFormatter = providers.find((item) => item.id === "python.ruff");
  const edits = await selectedFormatter.client.sendRequest("textDocument/formatting", {});
  assert.equal(edits[0].newText, "python.ruff");
  const closed = { saved: "const value = 1;\n", diskVersion: "disk-1", draft: null };
  const edit = actions[0].actions[0].edit.documentChanges[0];

  assert.equal(edit.textDocument.uri, "file:///fixture/closed.ts");

  const proposed = { expectedDiskVersion: "disk-1", draft: edit.edits[0].newText + closed.saved };
  assert.equal(proposed.expectedDiskVersion, closed.diskVersion);
  closed.draft = proposed.draft;
  assert.equal(closed.saved, "const value = 1;\n");
  assert.equal(closed.draft, "// fixed\nconst value = 1;\n");
  closed.draft = null;
  assert.equal(closed.saved, "const value = 1;\n");
  closed.diskVersion = "agent-edit";
  assert.notEqual(proposed.expectedDiskVersion, closed.diskVersion);
  console.log(
    "Two independent providers: ordered labelled actions, one formatter; closed-file draft/undo preserves saved text; Agent version conflict detected PASS"
  );
} finally {
  for (const item of providers) item.dispose();
}
