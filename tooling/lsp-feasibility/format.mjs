import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const requireFixture = createRequire(`${process.argv[2]}/package.json`);

const modulePath = requireFixture.resolve("@codemirror/lsp-client");

const requireClient = createRequire(modulePath);

const { formatDocument } = await import(pathToFileURL(modulePath));

const { EditorState } = await import(pathToFileURL(requireClient.resolve("@codemirror/state")));

let reply;

let formatting = Promise.resolve();

let dispatches = 0;

const plugin = {
  uri: "file:///fixture/open.ts",
  client: {
    sync() {},
    request(method) {
      assert.equal(method, "textDocument/formatting");

      return new Promise((resolve) => {
        reply = resolve;
      });
    },
    withMapping(handler) {
      formatting = handler({
        getMapping() {
          return null;
        },
        mapPosition() {
          return 0;
        },
      });
    },
  },
};

const view = {
  state: EditorState.create({ doc: "const value=1;" }),
  plugin() {
    return plugin;
  },
  dispatch() {
    dispatches++;
  },
};

assert.equal(formatDocument(view), true);

assert.equal(dispatches, 0);

reply([
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: "// formatted\n",
  },
]);

await formatting;

assert.equal(dispatches, 1);

console.log(
  "Real CM formatDocument command: returns boolean before delayed formatting dispatch; cannot await save preflight PASS"
);
