import { beforeEach, expect, test } from "bun:test";
import type { AppEvent, PolarisApi, Result } from "../../../../shared/api.ts";
import type { AppUpdateView } from "../../../../shared/appUpdates.ts";
import { standInBridge } from "../../bridge.ts";
import { checkForUpdates, connectUpdates, setAutomaticUpdates, updatesStore } from "./store.ts";

const current: AppUpdateView = {
  phase: "current",
  version: "0.4.0",
  availableVersion: null,
  automatic: true,
  lastCheckedAt: 1,
  installId: "58baf1dc-3772-4353-86b3-3a8a49219521",
  macOSVersion: "26.1",
  arch: "arm64",
  supported: true,
};

const ready: AppUpdateView = { ...current, phase: "ready", availableVersion: "0.5.0" };

const deferred = () => {
  let resolve: (value: Result<AppUpdateView>) => void = () => undefined;

  const promise = new Promise<Result<AppUpdateView>>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const fake = (delayedMethod: string) => {
  const pending = deferred();
  let listener: (event: AppEvent) => void = () => undefined;

  const api: PolarisApi = {
    request: (method) => {
      const response =
        method === delayedMethod ? pending.promise : Promise.resolve({ ok: true, value: current });

      // SAFETY: the test only calls the three view-returning Updates methods.
      return response as never;
    },
    subscribe: () => () => undefined,
    onAppEvent: (receive) => {
      listener = receive;

      return () => {
        listener = () => undefined;
      };
    },
  };

  standInBridge(api);
  const stop = connectUpdates(api);

  return {
    ...pending,
    stop,
    publish: (view: AppUpdateView) => listener({ kind: "updates", updates: view }),
  };
};

beforeEach(() => updatesStore.setState({ view: null, problem: null, changing: false }));

test("a ready AppEvent wins a delayed checking reply", async () => {
  const api = fake("updates.check");
  await Promise.resolve();
  const checking = checkForUpdates();
  api.publish(ready);
  api.resolve({ ok: true, value: { ...current, phase: "checking" } });
  await checking;

  expect(updatesStore.getState().view).toEqual(ready);
  api.stop();
});

test("a later AppEvent wins the automatic-setting reply while clearing its pending control", async () => {
  const api = fake("updates.setAutomatic");
  await Promise.resolve();
  const setting = setAutomaticUpdates(false);
  api.publish({ ...ready, automatic: false });
  api.resolve({ ok: true, value: { ...current, automatic: false, phase: "downloading" } });
  await setting;

  expect(updatesStore.getState()).toMatchObject({
    view: { ...ready, automatic: false },
    changing: false,
    problem: null,
  });
  api.stop();
});

test("a ready AppEvent also wins a delayed initial snapshot", async () => {
  const api = fake("updates.get");
  api.publish(ready);
  api.resolve({ ok: true, value: current });
  await Promise.resolve();

  expect(updatesStore.getState().view).toEqual(ready);
  api.stop();
});
