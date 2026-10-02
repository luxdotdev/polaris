import { expect, test } from "bun:test";
import { HostId, WorkspaceId, LanguageSettingsScope } from "@polaris/protocol";
import { effectiveSettings, configurationFingerprint } from "./configuration.ts";
import { jsonc } from "./typescript.ts";

test("effective preferences: app < language < Host < Workspace < Workspace-language", () => {
  const hostId = HostId.make("h");
  const workspaceId = WorkspaceId.make("w");
  const scope = LanguageSettingsScope.cases;

  const records = [
    {
      scope: scope.Workspace.make({ hostId, workspaceId, language: "python" }),
      settings: { interpreter: "workspace-language" },
    },
    {
      scope: scope.Workspace.make({ hostId, workspaceId, language: null }),
      settings: { interpreter: "workspace" },
    },
    { scope: scope.Host.make({ hostId }), settings: { interpreter: "host", formatOnSave: false } },
    { scope: scope.Language.make({ language: "python" }), settings: { interpreter: "language" } },
    { scope: scope.App.make({}), settings: { interpreter: "app" } },
    {
      scope: scope.Host.make({ hostId: HostId.make("other") }),
      settings: { interpreter: "wrong" },
    },
  ];

  const result = effectiveSettings({ hostId, workspaceId, language: "python" }, records, 7);
  expect(result.settings.interpreter).toBe("workspace-language");
  expect(result.formatOnSave).toBe(false);
  expect(result.origins.interpreter).toEqual(records[0]!.scope);
  expect(effectiveSettings({ hostId, workspaceId, language: "python" }, [], 0).formatOnSave).toBe(
    true
  );
  expect(configurationFingerprint({ a: 1, b: 2 })).toBe(configurationFingerprint({ b: 2, a: 1 }));
  expect(configurationFingerprint({ environment: { KEY: "a" } })).not.toBe(
    configurationFingerprint({ environment: { KEY: "b" } })
  );
});

test("JSONC keeps slash/comment/comma text inside strings", () => {
  expect(
    jsonc('{"url":"https://example.test/ /* not a comment */ ,}", /*comment*/ "items":[1,],}')
  ).toEqual({ url: "https://example.test/ /* not a comment */ ,}", items: [1] });
  expect(jsonc('{"items":[1, /* trailing comment */], /*end*/}')).toEqual({ items: [1] });
});
