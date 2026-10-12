import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { statusClosed, statusDiscovered, statusOpened, statusStore } from "./store.ts";

test.each([
  [P.LanguageFormatterSelection.cases.Provider.make({ providerId: "ruff" }), null],
  [
    P.LanguageFormatterSelection.cases.None.make({}),
    { tool: "oxfmt", ignored: false, trusted: false },
  ],
] as const)(
  "status follows the effective formatter over a repository config: %j",
  (selection, expected) => {
    const key = "formatter-routing";
    const workspaceId = P.WorkspaceId.make("formatter-routing");
    statusOpened(key, "lucas-rpi", "/repo/proof.py");

    try {
      statusDiscovered(
        key,
        P.LanguageDiscovery.make({
          checkout: P.LanguageCheckout.cases.Workspace.make({ workspaceId, path: "/repo" }),
          projectRoot: "/repo",
          providers: [],
          effectiveSettings: P.LanguageEffectiveSettings.make({
            revision: 0,
            formatOnSave: true,
            formatter: selection,
            providers: [],
            settings: {},
            origins: {},
          }),
          trust: P.LanguageTrust.make({
            scope: P.LanguageTrustScope.cases.Workspace.make({
              hostId: P.HostId.make("pi"),
              workspaceId,
            }),
            revision: 0,
            trusted: false,
          }),
          projectFormatter: P.LanguageProjectFormatter.make({
            tool: "oxfmt",
            root: "/repo",
            config: "/repo/oxfmt.config.mts",
            installed: false,
            ignored: false,
          }),
        })
      );
      expect(statusStore.getState().files[key]?.formatter).toEqual(expected);
    } finally {
      statusClosed(key);
    }
  }
);
