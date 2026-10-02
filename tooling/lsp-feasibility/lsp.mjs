import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { startServer, withDeadline } from "./process.mjs";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = process.argv[2];

const requireFixture = createRequire(join(root, "package.json"));

const sdk = createRequire(requireFixture.resolve("typescript/package.json"));

const serverPath = sdk.resolve("typescript/lib/tsserver.js");

const rpc = requireFixture("vscode-jsonrpc/node");

const server = startServer(root, [
  join(dirname(requireFixture.resolve("typescript-language-server/package.json")), "lib/cli.mjs"),
  "--stdio",
]);

const child = server.child;

child.stderr.on("data", (data) => process.stderr.write(data));

const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(child.stdout),
  new rpc.StreamMessageWriter(child.stdin)
);

const diagnostics = new Map();

connection.onNotification("textDocument/publishDiagnostics", (params) =>
  diagnostics.set(params.uri, params.diagnostics)
);

connection.onNotification("window/logMessage", (params) => console.log(`TLS: ${params.message}`));

connection.onRequest("workspace/configuration", ({ items }) => items.map(() => ({})));

connection.listen();

try {
  await withDeadline(
    (async () => {
      const initialize = await connection.sendRequest("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(root).href,
        capabilities: {
          textDocument: { publishDiagnostics: { versionSupport: true } },
          workspace: { configuration: true },
        },
        initializationOptions: {
          disableAutomaticTypingAcquisition: true,
          tsserver: {
            path: serverPath,
            useSyntaxServer: "never",
            logDirectory: join(root, "tls-logs"),
            logVerbosity: "normal",
          },
          plugins: ["next", "@effect/language-service", "workflow"].map((name) => ({
            name,
            location: root,
          })),
        },
      });

      if (process.argv[3] === "failure") throw new Error("Injected fixture failure");

      if (process.argv[3] === "timeout") await withDeadline(new Promise(() => {}), 50);
      assert.equal(initialize.capabilities.codeActionProvider, true);
      await connection.sendNotification("initialized", {});

      const texts = {
        "app/page.tsx":
          "export const invalidExport = 1;\nexport default function Page() { return null }\n",
        "effect.ts": 'import { Effect } from "effect";\nEffect.succeed(1);\n',
        "workflow.ts": 'export function example() { "use workflow"; return 1; }\n',
      };

      for (const [file, text] of Object.entries(texts))
        await connection.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: pathToFileURL(join(root, file)).href,
            languageId: file.endsWith("tsx") ? "typescriptreact" : "typescript",
            version: 1,
            text,
          },
        });
      const expected = { "app/page.tsx": 71002, "effect.ts": 3, "workflow.ts": 9001 };

      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          Object.entries(expected).every(([file, code]) =>
            diagnostics
              .get(pathToFileURL(join(root, file)).href)
              ?.some((item) => item.code === code)
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      for (const [file, code] of Object.entries(expected))
        assert.ok(
          diagnostics.get(pathToFileURL(join(root, file)).href)?.some((item) => item.code === code),
          `TLS missing plugin diagnostic: ${file}`
        );
      console.log(JSON.stringify({ diagnostics: Object.fromEntries(diagnostics) }));

      const actions = await connection.sendRequest("textDocument/codeAction", {
        textDocument: { uri: pathToFileURL(join(root, "effect.ts")).href },
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 18 } },
        context: { diagnostics: diagnostics.get(pathToFileURL(join(root, "effect.ts")).href) },
      });

      assert.ok(actions.length > 0);
      console.log(
        `Real TLS 6.0.1: three plugin diagnostics + ${actions.length} Effect code actions PASS`
      );
      const workflowUri = pathToFileURL(join(root, "workflow.ts")).href;

      for (const [version, text] of [
        [2, 'export function example() { "use workflow"; return 2; }\n'],
        [3, 'export async function example() { "use workflow"; return 3; }\n'],
      ]) {
        await connection.sendNotification("textDocument/didChange", {
          textDocument: { uri: workflowUri, version },
          contentChanges: [{ text }],
        });
      }

      for (let attempt = 0; attempt < 100; attempt++) {
        if (diagnostics.get(workflowUri)?.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.equal(
        diagnostics.get(workflowUri)?.length,
        0,
        "latest unsaved version did not clear Workflow error"
      );
      assert.equal(readFileSync(join(root, "workflow.ts"), "utf8"), texts["workflow.ts"]);
      console.log(
        "Real TLS ordered unsaved v2→v3 clears plugin error while disk remains invalid PASS"
      );

      await connection.sendRequest("shutdown");
      await connection.sendNotification("exit");
    })(),
    25000
  );
} finally {
  connection.dispose();
  await server.stop("TLS success/failure/timeout");
}
