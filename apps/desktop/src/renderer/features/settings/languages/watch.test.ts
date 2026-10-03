import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { HostView, LanguageApi } from "../../../../shared/api.ts";
import {
  LanguageSubscriptionItems,
  type LanguageSubscriptionItem,
  type LanguageSubscriptionKind,
} from "../../../../shared/languages.ts";
import { createIntegrationFixture } from "./integration.fixture.ts";
import { fixtureSnapshot } from "./fixture.ts";
import { watchLanguageFacts } from "./watch.ts";
import { LanguageInstallFeedback } from "./feedback.ts";
import { createLanguageSettingsAdapter } from "./adapter.ts";
import type { LanguageHostView } from "./contracts.ts";
import type { LanguageIntegrationOptions } from "./integrationContracts.ts";

const setup = () => {
  const fixture = createIntegrationFixture();

  const feeds: Array<{
    kind: string;
    stopped: boolean;
    emit: (items: ReadonlyArray<unknown>) => void;
    end: () => void;
  }> = [];

  const subscribe: LanguageApi["subscribe"] = <K extends LanguageSubscriptionKind>(
    kind: K,
    _input: Parameters<LanguageApi["subscribe"]>[1],
    listener: import("../../../../shared/api.ts").SubscriptionListener<LanguageSubscriptionItem<K>>
  ) => {
    const feed = {
      kind,
      stopped: false,
      emit: (items: ReadonlyArray<unknown>) => {
        const decoded = Schema.decodeUnknownSync(Schema.Array(LanguageSubscriptionItems[kind]))(
          items
        );

        listener.items(decoded);
      },
      end: () => listener.end?.(null),
    };

    feeds.push(feed);

    return () => {
      feed.stopped = true;
    };
  };

  const host: HostView = {
    ...fixture.host,
    status: {
      ...fixture.host.status,
      capabilities: [...fixture.host.status.capabilities, "languages.install"],
    },
  };

  const options: LanguageIntegrationOptions = {
    api: { ...fixture.api, subscribe },
    hosts: [host],
    selected: null,
    language: "python",
    recover: async () => ({ ok: true, value: undefined }),
  };

  const snapshot = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({}));
  const view = snapshot.hosts[0];
  const tool = view?.tools[0];

  if (!view || !tool) throw new Error("Missing fake facts");

  const availability = P.LanguageAvailability.make({
    ...tool.availability,
    checkedAt: 1,
    installation: P.LanguageInstallation.cases.Installing.make({ jobId: "job1", version: "1" }),
  });

  const initial = {
    ...snapshot,
    hosts: [
      { ...view, key: host.key, tools: [{ ...tool, availability, progress: null, actions: {} }] },
    ],
  };

  const progress = (sequence: number, jobId = "job1") =>
    P.LanguageInstallProgress.make({
      hostId: view.id,
      toolId: availability.toolId,
      version: "1",
      jobId,
      sequence,
      phase: "downloading",
      downloadedBytes: sequence,
      totalBytes: 100,
      message: "Fake",
      activeVersion: null,
    });

  return { fixture, options, feeds, initial, availability, progress };
};

test("actual typed feeds own current jobs, ignore old/foreign progress and retain absent permissions", () => {
  const f = setup();
  const values: Array<ReadonlyArray<LanguageHostView> | null> = [];
  const stop = watchLanguageFacts(f.options, f.initial, (hosts) => values.push(hosts));
  const job = f.feeds.find((feed) => feed.kind === "languages.install.watch");
  const availability = f.feeds.find((feed) => feed.kind === "languages.availability.watch");

  if (!job || !availability) throw new Error("Missing feeds");
  job.emit([f.progress(2)]);
  job.emit([f.progress(1), f.progress(3, "foreign"), { ...f.progress(4), hostId: "foreign" }]);
  expect(values).toHaveLength(1);
  expect(values[0]?.[0]?.tools[0]?.progress?.sequence).toBe(2);
  availability.emit([
    [
      {
        ...f.availability,
        checkedAt: 2,
        installation: P.LanguageInstallation.cases.Installing.make({ jobId: "job2", version: "1" }),
      },
    ],
  ]);
  expect(job.stopped).toBe(true);
  job.emit([f.progress(5)]);
  expect(values).toHaveLength(2);
  expect(values[1]?.[0]?.tools[0]?.actions).toEqual({});
  const next = f.feeds.at(-1);

  if (!next) throw new Error("Missing replacement job");
  next.emit([f.progress(1, "job2")]);
  expect(values).toHaveLength(3);
  stop();
  next.emit([f.progress(2, "job2")]);
  expect(values).toHaveLength(3);
  expect(f.feeds.every((feed) => feed.stopped)).toBe(true);
});

test("feed end fails closed; reconnect has fresh ownership and old Host subscribes to nothing", () => {
  const f = setup();
  const values: Array<unknown> = [];
  watchLanguageFacts(f.options, f.initial, (hosts) => values.push(hosts));
  f.feeds[0]?.end();
  expect(values).toEqual([null]);
  f.feeds[0]?.emit([f.progress(1)]);
  expect(values).toHaveLength(1);
  const stop = watchLanguageFacts(f.options, f.initial, (hosts) => values.push(hosts));
  f.feeds[2]?.emit([f.progress(1)]);
  expect(values).toHaveLength(2);
  stop();
  const count = f.feeds.length;
  watchLanguageFacts({ ...f.options, api: undefined }, f.initial, () => {
    throw new Error("Old API event");
  })();
  expect(f.feeds).toHaveLength(count);
});

test("adapter reload disposes prior feed and late old callbacks cannot reclaim current authority", async () => {
  const f = setup();
  const adapter = createLanguageSettingsAdapter(f.options);
  const scope = P.LanguageSettingsScope.cases.App.make({});
  const signal = new AbortController().signal;
  const first = await adapter.load(scope, signal);

  if (!first.ok) throw new Error(first.message);
  let calls = 0;
  adapter.watch?.(first.value, () => {
    calls++;
  });
  const old = f.feeds[0];
  await adapter.load(scope, signal);
  expect(old?.stopped).toBe(true);
  old?.end();
  expect(calls).toBe(0);
  adapter.watch?.(first.value, () => {
    throw new Error("Obsolete snapshot");
  });
  expect(f.feeds).toHaveLength(1);
});

test("bound feedback names selected language/Host and emits phase transitions, not byte ticks", () => {
  const f = setup();
  const notices: Array<[string, string]> = [];
  const feedback = new LanguageInstallFeedback((title, message) => notices.push([title, message]));
  const stop = watchLanguageFacts({ ...f.options, feedback }, f.initial, () => {});
  const job = f.feeds[0];

  if (!job) throw new Error("Missing job feed");
  job.emit([f.progress(1), f.progress(2)]);
  job.emit([{ ...f.progress(3), phase: "verifying" }]);
  job.emit([f.progress(4, "obsolete")]);
  expect(notices).toHaveLength(2);
  expect(notices[0]?.[0]).toBe(`python · ${f.initial.hosts[0]?.name}`);
  expect(notices[1]?.[1]).toContain("verifying");
  stop();
  feedback.dispose();
});

test("same-job availability refresh retains sequence authority and latest progress", () => {
  const f = setup();
  const values: Array<ReadonlyArray<LanguageHostView> | null> = [];
  const stop = watchLanguageFacts(f.options, f.initial, (hosts) => values.push(hosts));
  const job = f.feeds[0];
  const availability = f.feeds[1];

  if (!job || !availability) throw new Error("Missing feeds");
  job.emit([f.progress(5)]);
  availability.emit([[{ ...f.availability, checkedAt: 2 }]]);
  expect(f.feeds).toHaveLength(2);
  expect(job.stopped).toBe(false);
  expect(values.at(-1)?.[0]?.tools[0]?.progress?.sequence).toBe(5);
  job.emit([f.progress(4)]);
  expect(values).toHaveLength(2);
  stop();
});

test("Page schema-normalized record copy retains current adapter watch ownership", async () => {
  const f = setup();
  const adapter = createLanguageSettingsAdapter(f.options);
  const scope = P.LanguageSettingsScope.cases.App.make({});
  const loaded = await adapter.load(scope, new AbortController().signal);

  if (!loaded.ok) throw new Error(loaded.message);

  const displayed = {
    ...loaded.value,
    record: Schema.decodeUnknownSync(P.LanguageSettingsRecord)(loaded.value.record),
  };

  const stop = adapter.watch?.(displayed, () => {});
  expect(f.feeds).toHaveLength(1);
  stop?.();
  expect(f.feeds.every((feed) => feed.stopped)).toBe(true);
});

test("opaque Page observation rejects obsolete same-CAS, absent, foreign adapter and altered records", async () => {
  const f = setup();
  const adapter = createLanguageSettingsAdapter(f.options);
  const other = createLanguageSettingsAdapter(f.options);
  const scope = P.LanguageSettingsScope.cases.App.make({});
  const signal = new AbortController().signal;
  const old = await adapter.load(scope, signal);
  const current = await adapter.load(scope, signal);
  const foreign = await other.load(scope, signal);

  if (!old.ok || !current.ok || !foreign.ok) throw new Error("Missing fake observations");
  expect(current.value.record).toEqual(old.value.record);
  expect(current.value.observation).not.toBe(old.value.observation);
  expect(current.value.observation).not.toBe(foreign.value.observation);

  for (const rejected of [
    old.value,
    foreign.value,
    { ...current.value, observation: {} },
    { ...current.value, record: { ...current.value.record, revision: 99 } },
    { ...current.value, record: { ...current.value.record, settings: { formatOnSave: false } } },
    {
      ...current.value,
      record: {
        ...current.value.record,
        scope: P.LanguageSettingsScope.cases.Language.make({ language: "python" }),
      },
    },
  ])
    adapter.watch?.(rejected, () => {
      throw new Error("Rejected observation callback");
    });
  const { observation: _observation, ...absent } = current.value;
  adapter.watch?.(absent, () => {
    throw new Error("Absent observation callback");
  });
  expect(f.feeds).toHaveLength(0);
  const stop = adapter.watch?.({ ...current.value, hosts: [] }, () => {});
  expect(f.feeds).toHaveLength(1);
  f.feeds[0]?.end();
  adapter.watch?.(current.value, () => {
    throw new Error("Ended observation callback");
  });
  expect(f.feeds).toHaveLength(1);
  stop?.();
});
