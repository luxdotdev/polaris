import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import {
  LanguageRequestInputs,
  type LanguageRequestMethod,
  type LanguageRequestInput,
} from "../../../../shared/languages.ts";
import { initialState } from "../../../store/store.ts";
import { bindFormatter, createAppFormatting, readFormatSettings } from "./bridge.ts";
import { SaveCoordinator } from "./index.ts";

const file = { hostKey: "fixture", workspaceId: "ws_fixture", path: "/fixture/main.ts" };

const formatter = P.LanguageFormatterSelection.cases.Provider.make({ providerId: "selected" });

const host = P.HostInfo.make({
  hostId: Schema.decodeUnknownSync(P.HostId)("h_fixture"),
  hostname: "fixture",
  platform: "darwin-arm64",
  daemonVersion: "0.0.0",
  homeDir: "/fixture",
  startedAt: "2026-10-02T00:00:00Z",
});

for (const change of ["replace", "same-port", "cancel"]) {
  test(`active ${change} rejects stale formatter response; old disposer keeps a newer registration`, async () => {
    let finish: (value: string) => void = () => undefined;

    const gate = new Promise<string>((resolve) => {
      finish = resolve;
    });

    const old = {
      settings: async () => ({ formatOnSave: true, formatter }),
      format: async () => gate,
    };

    const remove = bindFormatter(file, old);
    const formatting = createAppFormatting(() => app);
    const controller = new AbortController();

    const snapshot = {
      file,
      text: "current unsaved",
      version: 1,
      diskVersion: null,
      reason: "manual" as const,
    };

    let removeNext: () => void = () => undefined;

    try {
      await formatting.settings(file, controller.signal);
      const pending = formatting.format(snapshot, formatter, controller.signal);

      if (change === "cancel") controller.abort();
      else {
        remove();
        removeNext = bindFormatter(
          file,
          change === "same-port"
            ? old
            : { settings: old.settings, format: async () => "current registration" }
        );
        remove();
      }

      finish("obsolete text");

      const error = await pending.catch((cause: unknown) =>
        cause instanceof Error ? cause.message : ""
      );

      expect(error).toBe("Formatter context changed while saving.");

      if (change !== "cancel") {
        const nextSignal = new AbortController().signal;

        await formatting.settings(file, nextSignal);
        expect(await formatting.format(snapshot, formatter, nextSignal)).toBe(
          change === "same-port" ? "obsolete text" : "current registration"
        );
      }
    } finally {
      remove();
      removeNext();
    }
  });
}

test("replacement failure still writes current unsaved text and reports formatting failure", async () => {
  let finish: (value: string) => void = () => undefined;
  let started: () => void = () => undefined;

  const gate = new Promise<string>((resolve) => {
    finish = resolve;
  });

  const active = new Promise<void>((resolve) => {
    started = resolve;
  });

  const remove = bindFormatter(file, {
    settings: async () => ({ formatOnSave: true, formatter }),
    format: async () => {
      started();

      return gate;
    },
  });

  const formatting = createAppFormatting(() => app);
  let text = "current unsaved";
  let disk = "";
  const notices: string[] = [];

  const coordinator = new SaveCoordinator(
    {
      snapshot: (reason) => ({ file, text, version: 1, diskVersion: null, reason }),
      current: (snapshot) => snapshot.text === text,
      apply: (next) => {
        text = next;
      },
      write: async () => {
        disk = text;

        return true;
      },
    },
    { ...formatting, failure: (_file, message) => notices.push(message) }
  );

  const saved = coordinator.save("manual");

  await active;
  remove();
  finish("obsolete text");
  expect(await saved).toBe(true);
  expect(disk).toBe("current unsaved");
  expect(notices).toEqual(["Formatter context changed while saving."]);
});

const settingsApi = (patches: P.LanguageSettingsPatch[]) => {
  let calls = 0;

  const api: LanguageApi = {
    request: async <M extends LanguageRequestMethod>(method: M, input: LanguageRequestInput<M>) => {
      if (method !== "languages.settings.get") throw new Error("Unexpected request");

      const request = Schema.decodeUnknownSync(LanguageRequestInputs["languages.settings.get"])(
        input
      );

      const record = P.LanguageSettingsRecord.make({
        scope: request.scope,
        revision: calls,
        settings: patches[calls++] ?? {},
      });

      return { ok: true, value: record };
    },
    subscribe: () => () => undefined,
  };

  return { api, calls: () => calls };
};

const app = {
  ...initialState,
  hosts: [
    {
      key: "fixture",
      label: "fixture",
      colour: null,
      alias: null,
      proofHarness: false,
      status: {
        state: "connected",
        failure: null,
        attempt: 0,
        since: 0,
        nextAttemptAt: null,
        host,
        capabilities: [],
        epoch: 1,
        latencyMs: null,
        lastSeenAt: null,
      },
    },
  ],
} satisfies typeof initialState;

test("real settings lookup merges App, language, Host, Workspace and Workspace language", async () => {
  const f = settingsApi([
    { formatOnSave: false },
    { formatOnSave: true, formatter },
    {},
    { formatOnSave: false },
    { formatOnSave: true },
  ]);

  expect(await readFormatSettings(file, app, f.api)).toEqual({ formatOnSave: true, formatter });
  expect(f.calls()).toBe(5);
  const defaults = settingsApi([]);

  expect(await readFormatSettings(file, app, defaults.api)).toEqual({
    formatOnSave: true,
    formatter: P.LanguageFormatterSelection.cases.None.make({}),
  });
});

test("selected unbound provider fails explicitly; binding replacement cannot service an older preflight", async () => {
  const api = settingsApi([{ formatter }]);

  const formatting = createAppFormatting(
    () => app,
    () => ({
      languages: api.api,
      request: async () => {
        throw new Error("unexpected");
      },
      subscribe: () => () => undefined,
      onAppEvent: () => () => undefined,
    })
  );

  const signal = new AbortController().signal;

  const snapshot = {
    file,
    text: "unsaved",
    version: 2,
    diskVersion: null,
    reason: "manual" as const,
  };

  expect((await formatting.settings(file, signal)).formatter).toEqual(formatter);

  const failure = await formatting
    .format(snapshot, formatter, signal)
    .catch((cause: unknown) => (cause instanceof Error ? cause.message : ""));

  expect(failure).toContain("unavailable");

  const remove = bindFormatter(file, {
    settings: async () => ({ formatOnSave: true, formatter }),
    format: async () => "one",
  });

  await formatting.settings(file, signal);

  const removeNext = bindFormatter(file, {
    settings: async () => ({ formatOnSave: true, formatter }),
    format: async () => "two",
  });

  remove();

  const replaced = await formatting
    .format(snapshot, formatter, signal)
    .catch((cause: unknown) => (cause instanceof Error ? cause.message : ""));

  expect(replaced).toContain("unavailable");
  await formatting.settings(file, signal);
  expect(await formatting.format(snapshot, formatter, signal)).toBe("two");

  removeNext();
});
