import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";

const root = process.argv[2];

const projectRequire = createRequire(join(root, "package.json"));

const aliasPackage = projectRequire.resolve("typescript/package.json");

assert.equal(JSON.parse(readFileSync(aliasPackage)).name, "@typescript/typescript6");

assert.equal(existsSync(join(dirname(aliasPackage), "lib/tsserver.js")), false);

const sdkRequire = createRequire(aliasPackage);

const serverPath = sdkRequire.resolve("typescript/lib/tsserver.js");

console.log(
  JSON.stringify({
    aliasPackage,
    serverPath,
    sdkVersion: sdkRequire("typescript/package.json").version,
  })
);

const plugins = ["next", "@effect/language-service", "workflow"];

for (const plugin of plugins) console.log(`probe ${plugin}: ${projectRequire.resolve(plugin)}`);

mkdirSync(join(root, "app"), { recursive: true });

const files = {
  "app/page.tsx":
    "export const invalidExport = 1;\nexport default function Page() { return null }\n",
  "effect.ts": 'import { Effect } from "effect";\nEffect.succeed(1);\n',
  "workflow.ts": 'export function example() { "use workflow"; return 1; }\n',
};

for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);

const config = {
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "es2022",
    jsx: "preserve",
    skipLibCheck: true,
  },
  include: ["app/**/*.tsx", "*.ts"],
};

async function probe(enabled) {
  config.compilerOptions.plugins = enabled
    ? [
        { name: "next" },
        { name: "@effect/language-service", diagnosticSeverity: { floatingEffect: "warning" } },
        { name: "workflow" },
      ]
    : [];
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config));
  const log = join(root, enabled ? "plugins.log" : "control.log");

  const child = spawn(
    process.execPath,
    [
      serverPath,
      "--disableAutomaticTypingAcquisition",
      "--pluginProbeLocations",
      root,
      "--logVerbosity",
      "verbose",
      "--logFile",
      log,
    ],
    {
      cwd: root,
      env: { ...process.env, HOME: join(root, "home") },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let buffer = Buffer.alloc(0);
  let sequence = 0;
  const pending = new Map();
  child.stdout.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);

    while (true) {
      const header = buffer.indexOf("\r\n\r\n");

      if (header < 0) break;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, header).toString())[1]);

      if (buffer.length < header + 4 + length) break;
      const message = JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString());
      buffer = buffer.subarray(header + 4 + length);

      if (message.type === "response") pending.get(message.request_seq)?.(message);
    }
  });
  child.stderr.on("data", (data) => process.stderr.write(data));

  function request(command, args) {
    const seq = ++sequence;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(seq);
        reject(new Error(`timeout ${command}`));
      }, 20000);

      pending.set(seq, (response) => {
        clearTimeout(timer);
        pending.delete(seq);
        resolve(response);
      });
      child.stdin.write(JSON.stringify({ seq, type: "request", command, arguments: args }) + "\n");
    });
  }

  try {
    await request("configure", { preferences: {}, hostInfo: "polaris-f1" });
    await request("updateOpen", {
      openFiles: Object.entries(files).map(([file, fileContent]) => ({
        file: join(root, file),
        fileContent,
        projectRootPath: root,
      })),
    });
    const diagnostics = {};

    for (const file of Object.keys(files)) {
      const response = await request("semanticDiagnosticsSync", { file: join(root, file) });
      assert.equal(response.success, true, JSON.stringify(response));
      diagnostics[file] = response.body;
    }

    console.log(JSON.stringify({ enabled, diagnostics }));

    if (enabled) {
      const logs = readFileSync(log, "utf8");

      for (const plugin of plugins)
        assert.ok(
          logs.includes(`Enabling plugin ${plugin} from candidate paths:`),
          `plugin not loaded: ${plugin}`
        );
    }

    return diagnostics;
  } finally {
    child.kill();
  }
}

const control = await probe(false);

const actual = await probe(true);

assert.ok(
  actual["app/page.tsx"].some((item) => item.code === 71002),
  "Next invalid page export"
);

assert.ok(
  actual["effect.ts"].some((item) => String(item.text).includes("floatingEffect")),
  "Effect floating diagnostic"
);

assert.ok(
  actual["workflow.ts"].some((item) => String(item.text).includes("must be async")),
  "Workflow async diagnostic"
);

for (const file of Object.keys(files))
  assert.equal(control[file].length, 0, `unexpected control diagnostics ${file}`);

console.log(
  "Alias-aware tsserver + project plugin probe: Next/Effect/Workflow differential diagnostics PASS"
);
