import { expect, test } from "bun:test";
import { Schema } from "effect";
import { readFileSync } from "node:fs";
import {
  LanguageExecutable,
  LanguageCatalog,
  LanguageEffectiveSettings,
  LanguageEnvironment,
  LanguageLaunchFact,
  LanguageFormatterSelection,
  LanguageRegistration,
  LanguageServerRequestPayload,
  LanguageSettingsPatch,
  LanguageSettingsScope,
  LanguageWorkspaceEdit,
} from "./index.ts";

test("opaque server registration IDs roundtrip through registration and unregistration", () => {
  for (const id of [
    "server/register:formatting _1",
    "",
    "_id",
    "provider ⚙ /:[]",
    "a".repeat(1024),
  ]) {
    const registration = { id, method: "textDocument/formatting" };

    const unregister = LanguageServerRequestPayload.cases.Unregister.make({
      unregistrations: [registration],
    });

    expect<unknown>(
      Schema.encodeSync(LanguageRegistration)(
        Schema.decodeUnknownSync(LanguageRegistration)(registration)
      )
    ).toEqual(registration);

    expect<unknown>(
      Schema.encodeSync(LanguageServerRequestPayload)(
        Schema.decodeUnknownSync(LanguageServerRequestPayload)(unregister)
      )
    ).toEqual(unregister);
  }
});

test("opaque annotations preserve matching keys on text and every resource operation", () => {
  const annotationId = "rename:src/main.ts _1";

  const edit = {
    changes: {},
    changeAnnotations: { [annotationId]: { label: "Rename", needsConfirmation: true } },
    documentChanges: [
      {
        textDocument: { uri: "file:///tmp/main.ts", version: null },
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            newText: "x",
            annotationId,
          },
        ],
      },
      { kind: "create", uri: "file:///tmp/new.ts", annotationId },
      {
        kind: "rename",
        oldUri: "file:///tmp/main.ts",
        newUri: "file:///tmp/moved.ts",
        annotationId,
      },
      { kind: "delete", uri: "file:///tmp/old.ts", annotationId },
    ],
  };

  expect<unknown>(
    Schema.encodeSync(LanguageWorkspaceEdit)(Schema.decodeUnknownSync(LanguageWorkspaceEdit)(edit))
  ).toEqual(edit);
});

test("environment names preserve leading underscore and reject invalid names instead of erasing", () => {
  const executable = {
    executable: "/usr/bin/java",
    argv: [],
    environment: { _JAVA_OPTIONS: "-Xmx512m", PATH: "/tmp/bin", java_home2: "/tmp/jdk" },
  };

  expect<unknown>(
    Schema.encodeSync(LanguageExecutable)(Schema.decodeUnknownSync(LanguageExecutable)(executable))
  ).toEqual(executable);

  for (const name of ["9PATH", "JAVA-HOME", "JAVA HOME", "A=B", "A\u0000B", "", "a".repeat(129)]) {
    expect(() =>
      Schema.decodeUnknownSync(LanguageExecutable)({
        ...executable,
        environment: { [name]: "value" },
      })
    ).toThrow();
  }

  expect(() =>
    Schema.decodeUnknownSync(LanguageEnvironment)({ PATH: "x".repeat(65537) })
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(LanguageEnvironment)(
      Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`ENV_${index}`, "x"]))
    )
  ).toThrow();
});

test("invalid external and Polaris record keys fail instead of decoding to empty maps", () => {
  expect(() =>
    Schema.decodeUnknownSync(LanguageWorkspaceEdit)({ changes: { "not a URI": [] } })
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(LanguageWorkspaceEdit)({
      changeAnnotations: { ["a".repeat(1025)]: { label: "too long" } },
    })
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(LanguageRegistration)({ id: 1, method: "textDocument/formatting" })
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(LanguageRegistration)({
      id: "a".repeat(1025),
      method: "textDocument/formatting",
    })
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(LanguageSettingsPatch)({ serverSettings: { "invalid:provider": {} } })
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(LanguageSettingsPatch)({
      executableOverrides: {
        "invalid:provider": { executable: "/bin/tool", argv: [], environment: {} },
      },
    })
  ).toThrow();

  expect(() =>
    Schema.decodeUnknownSync(LanguageEffectiveSettings)({
      revision: 1,
      formatOnSave: true,
      formatter: LanguageFormatterSelection.cases.None.make({}),
      providers: [],
      settings: {},
      origins: { "invalid:setting": LanguageSettingsScope.cases.App.make({}) },
    })
  ).toThrow();
});

test("catalog environment and launch facts preserve the same valid environment names", () => {
  const catalog = Schema.decodeUnknownSync(LanguageCatalog)(
    JSON.parse(
      readFileSync(
        new URL("../../../../apps/daemon/src/languages/catalog/catalog.json", import.meta.url),
        "utf8"
      )
    )
  );

  const environment = { _JAVA_OPTIONS: "-Xmx512m" };

  const withEnvironment = {
    ...catalog,
    tools: catalog.tools.map((tool) => ({ ...tool, environment })),
  };

  expect<unknown>(
    Schema.encodeSync(LanguageCatalog)(Schema.decodeUnknownSync(LanguageCatalog)(withEnvironment))
  ).toEqual(withEnvironment);

  expect(() =>
    Schema.decodeUnknownSync(LanguageCatalog)({
      ...catalog,
      tools: catalog.tools.map((tool) => ({ ...tool, environment: { "JAVA-OPTIONS": "x" } })),
    })
  ).toThrow();

  const launch = {
    providerId: "java",
    executable: "/usr/bin/java",
    argv: [],
    workingDirectory: "/tmp/fake",
    environmentKeys: ["_JAVA_OPTIONS"],
    sdk: null,
    interpreter: null,
    pluginProbeRoots: [],
    configurationFingerprint: "a".repeat(64),
  };

  expect<unknown>(
    Schema.encodeSync(LanguageLaunchFact)(Schema.decodeUnknownSync(LanguageLaunchFact)(launch))
  ).toEqual(launch);
});
