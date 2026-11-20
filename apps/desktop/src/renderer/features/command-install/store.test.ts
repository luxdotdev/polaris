import { afterEach, expect, test } from "bun:test";
import type { CommandInstallView } from "../../../shared/commandInstall.ts";
import type { PolarisApi, Result } from "../../../shared/api.ts";
import { standInBridge } from "../bridge.ts";
import { changeCommandInstall, commandInstallStore, refreshCommandInstall } from "./store.ts";

afterEach(() => {
  standInBridge(null);
  commandInstallStore.setState({ view: null, busy: false, problem: null });
});

test("an old status read cannot undo the installed state returned by a later action", async () => {
  const absent: CommandInstallView = {
    supported: true,
    available: true,
    dismissed: false,
    links: [
      { location: "user", path: "/fixture/.local/bin/polaris", state: "absent", onPath: true },
    ],
  };

  const installed: CommandInstallView = {
    ...absent,
    links: absent.links.map((link) => ({ ...link, state: "installed" })),
  };

  let resolve: (reply: Result<CommandInstallView>) => void = () => {};

  const pending = new Promise<Result<CommandInstallView>>((done) => {
    resolve = done;
  });

  const api: PolarisApi = {
    request: (method) => {
      // SAFETY: this test calls only the two CommandInstallView-returning methods.
      return (
        method === "commandInstall.get" ? pending : Promise.resolve({ ok: true, value: installed })
      ) as never;
    },
    subscribe: () => () => {},
    onAppEvent: () => () => {},
  };

  standInBridge(api);
  const reading = refreshCommandInstall();
  await changeCommandInstall("install", "user");
  resolve({ ok: true, value: absent });
  await reading;
  expect(commandInstallStore.getState().view?.links[0]?.state).toBe("installed");
});
