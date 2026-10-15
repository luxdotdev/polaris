import { expect, test } from "bun:test";
import { forEachDiagnostic } from "@codemirror/lint";
import { Text } from "@codemirror/state";
import * as P from "@polaris/protocol";
import { Option, Schema } from "effect";
import type { PredictedEdit } from "@polaris/protocol";
import { diagnosticsVerifier } from "../prediction/verify/index.ts";
import { coordinatorFixture } from "./coordinator.testing.ts";

const MODULE = 'import { a } from "./a";\nmissing();\n';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every call to an undeclared `missing` is an unresolved name, the scripted server's only error. */
const errorsIn = (text: string) => {
  const doc = Text.of(text.split("\n"));

  if (text.includes("const missing")) return [];

  return [...text.matchAll(/missing\(/g)].map((match) => {
    const line = doc.lineAt(match.index);
    const start = { line: line.number - 1, character: match.index - line.from };

    return { start, end: { ...start, character: start.character + 7 } };
  });
};

const pullReport = (text: string) => ({
  kind: "full",
  items: errorsIn(text).map((range) => ({
    range,
    severity: 1,
    code: 2304,
    message: "Cannot find name 'missing'.",
  })),
});

interface Server {
  readonly diagnostics: "push" | "pull";
  readonly extra: readonly string[];
  readonly commands: readonly string[];
}

const PULL: Server = { diagnostics: "pull", extra: ["textDocument/diagnostic"], commands: [] };

/** typescript-language-server: tsserver puts an unsaved file in an inferred project, not the file's. */
const TSSERVER: Server = {
  diagnostics: "push",
  extra: ["workspace/executeCommand"],
  commands: ["typescript.tsserverRequest"],
};

const PUSH_ONLY: Server = { diagnostics: "push", extra: [], commands: [] };

const setup = async (server: Server, doc = MODULE, importFix: string | null = null) => {
  const f = coordinatorFixture(doc);
  f.service.capabilities = P.LanguageProviderCapabilities.make({
    ...f.service.capabilities,
    diagnostics: server.diagnostics,
    methods: [...f.service.capabilities.methods, ...server.extra],
    executeCommands: [...server.commands],
  });

  f.service.respond = (request, documents) => {
    if (request.method === "textDocument/codeAction")
      return importFix === null ? [] : [{ title: importFix, kind: "quickfix" }];

    if (request.method === "textDocument/diagnostic") {
      const { uri } = Schema.decodeUnknownSync(
        Schema.Struct({ textDocument: Schema.Struct({ uri: Schema.String }) })
      )(request.params).textDocument;

      // A pushing server also publishes for every open document, the shadow included.
      if (uri !== "file:///reuse/a.ts") f.service.diagnose(uri);

      return pullReport(documents.get(uri)?.text ?? "");
    }

    return undefined;
  };

  const file = f.open("a.ts");
  await f.settled(file);
  const verifier = file.view.state.facet(diagnosticsVerifier);

  if (verifier === null) throw new Error("The coordinator provides no verifier");

  return { f, file, verifier };
};

const check = (doc: Text, edits: PredictedEdit[], cursor = 0) => ({ doc, edits, cursor });

const syncs = (f: ReturnType<typeof coordinatorFixture>) =>
  f.service.notifications.map((notification) => [notification._tag, notification.uri]);

const append = (doc: Text, text: string): PredictedEdit[] => [
  { from: doc.length, to: doc.length, text },
];

test("an edit that adds an error is rejected, a clean one allowed; the shadow opens and closes", async () => {
  const { f, file, verifier } = await setup(PULL);

  try {
    const doc = file.view.state.doc;
    expect(verifier.attached(doc)).toBe(true);

    const broken = await verifier.verify(
      check(doc, append(doc, "missing();\n")),
      new AbortController().signal
    );

    expect(broken).toMatchObject({ allow: false, shadowed: [] });
    expect(broken?.allow === false && broken.introduced.map((error) => error.message)).toEqual([
      "Cannot find name 'missing'.",
    ]);

    const clean = await verifier.verify(
      check(doc, append(doc, "a();\n")),
      new AbortController().signal
    );

    expect(clean).toEqual({ allow: true });
    await flush(5);
    const shadows = syncs(f).filter(([, uri]) => uri !== "file:///reuse/a.ts");
    expect(shadows.map(([tag]) => tag)).toEqual(["Open", "Close", "Open", "Close"]);
    expect(shadows[0]?.[1]).toMatch(/^file:\/\/\/reuse\/a\.polaris-verify-\d+\.ts$/);
  } finally {
    f.coordinator.dispose();
  }
});

test("the shadow's diagnostics never reach the Editor's feed or its painted diagnostics", async () => {
  const { f, file, verifier } = await setup(PULL);

  try {
    const doc = file.view.state.doc;
    await verifier.verify(check(doc, append(doc, "missing();\n")), new AbortController().signal);
    await flush();

    // The pull handler pushed a diagnostic for each shadow while it was open.
    expect(file.entry()?.diagnostics.values()).toEqual([]);
    let painted = 0;
    forEachDiagnostic(file.view.state, () => painted++);
    expect(painted).toBe(0);

    f.service.diagnose("file:///reuse/a.ts");
    await flush();
    expect(file.entry()?.diagnostics.values()).toHaveLength(1);
  } finally {
    f.coordinator.dispose();
  }
});

test("a local stand-in for a name the server would import is rejected; other definitions pass", async () => {
  for (const [title, allow] of [
    ['Add import from "./missing"', false],
    ["Declare function 'missing'", true],
  ] as const) {
    const { f, file, verifier } = await setup(PULL, MODULE, title);

    try {
      const doc = file.view.state.doc;

      const verdict = await verifier.verify(
        check(doc, append(doc, "const missing = () => 1;\n")),
        new AbortController().signal
      );

      expect(verdict?.allow).toBe(allow);
    } finally {
      f.coordinator.dispose();
    }
  }
});

test("only TypeScript modules on a server with pull diagnostics are checked", async () => {
  for (const [server, doc] of [
    [PUSH_ONLY, MODULE],
    [TSSERVER, MODULE],
    [PULL, "missing();\n"],
    [PULL, "export {};\ndeclare global {\n  const x: number;\n}\n"],
  ] as const) {
    const { f, file, verifier } = await setup(server, doc);

    try {
      expect(verifier.attached(file.view.state.doc)).toBe(false);
    } finally {
      f.coordinator.dispose();
    }
  }
});

const held = (f: ReturnType<typeof coordinatorFixture>) => {
  let release = () => {};

  f.service.hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  return () => {
    f.service.hold = null;
    release();
  };
};

const opened = async (f: ReturnType<typeof coordinatorFixture>) => {
  for (
    let i = 0;
    i < 100 && !syncs(f).some(([tag]) => tag === "Open" && f.service.requests.length > 0);
    i++
  )
    await flush(1);
};

test("Editor requests wait while a shadow is open, so no answer can mention it", async () => {
  const { f, file, verifier } = await setup(PULL);

  try {
    const doc = file.view.state.doc;
    const release = held(f);

    const verdict = verifier.verify(
      check(doc, append(doc, "a();\n")),
      new AbortController().signal
    );

    await opened(f);
    const hover = file.entry()?.features.hover(0);
    await flush(5);
    release();
    await verdict;
    await hover;

    const order = f.requestInputs.flatMap((entry) => {
      const sync = Schema.decodeUnknownOption(
        Schema.Struct({ input: Schema.Struct({ notification: P.LanguageDocumentNotification }) })
      )(entry);

      if (Option.isSome(sync)) return [sync.value.input.notification._tag];

      const feature = Schema.decodeUnknownOption(
        Schema.Struct({ input: P.LanguageFeatureRequest })
      )(entry);

      return Option.isSome(feature) ? [feature.value.input.method] : [];
    });

    expect(order.indexOf("textDocument/hover")).toBeGreaterThan(order.lastIndexOf("Close"));
    const fence = f.service.requests.find((request) => request.method === "textDocument/hover");
    expect(fence?.fence.documents.map(({ uri }) => uri)).toEqual(["file:///reuse/a.ts"]);
  } finally {
    f.coordinator.dispose();
  }
});

test("an abort answers at once, cancels the Host's request and closes the shadow", async () => {
  const { f, file, verifier } = await setup(PULL);

  try {
    const doc = file.view.state.doc;
    const release = held(f);
    const controller = new AbortController();
    const verdict = verifier.verify(check(doc, append(doc, "a();\n")), controller.signal);
    await opened(f);
    controller.abort();

    expect(await verdict).toBeNull();
    await flush(5);
    expect(f.requests).toContain("languages.cancel");
    expect(syncs(f).at(-1)?.[0]).toBe("Close");
    release();
  } finally {
    f.coordinator.dispose();
  }
});

test("a Host that refuses the shadow fails open instead of breaking the Editor's context", async () => {
  const { f, file, verifier } = await setup(PULL);

  try {
    const doc = file.view.state.doc;
    f.service.refuse = (notification) => notification.uri.includes(".polaris-verify-");

    expect(
      await verifier.verify(check(doc, append(doc, "missing();\n")), new AbortController().signal)
    ).toBeNull();
    expect(file.entry()?.features.options.providers()).toHaveLength(1);
    expect(await file.entry()?.features.hover(0)).toHaveLength(1);
  } finally {
    f.coordinator.dispose();
  }
});
