import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { LanguageSubscriptionItems, type LanguageSubscriptionItem } from "./languages.ts";

const context = P.LanguageContextIdentity.make({
  hostId: P.HostId.make("fake"),
  clientId: "client",
  contextId: "context",
  checkout: P.LanguageCheckout.cases.Workspace.make({
    workspaceId: P.WorkspaceId.make("fake"),
    path: "/fixture",
  }),
  projectRoot: "/fixture",
  providerId: "fake",
  configurationFingerprint: "a".repeat(64),
  generation: 1,
});

const event: LanguageSubscriptionItem<"languages.context.watch"> =
  P.LanguageContextEvent.cases.Invalidated.make({ context, reason: "restart" });

const availability: P.LanguageAvailability = P.LanguageAvailability.make({
  hostId: context.hostId,
  toolId: "fake",
  pinnedVersion: "1",
  platform: { os: "darwin", arch: "arm64", libc: "none" },
  installation: P.LanguageInstallation.cases.NotInstalled.make({}),
  updateCandidate: null,
  phase: "feature",
  prerequisites: [],
  preflight: P.LanguagePreflight.cases.Eligible.make({ artifactId: null }),
  checkedAt: 1,
});

test("install IPC items decode per-job progress with the existing wire bounds", () => {
  const progress: LanguageSubscriptionItem<"languages.install.watch"> =
    P.LanguageInstallProgress.make({
      hostId: context.hostId,
      toolId: "fake",
      version: "1",
      jobId: "job",
      sequence: 1,
      phase: "queued",
      downloadedBytes: 0,
      totalBytes: null,
      message: "Fake only",
      activeVersion: null,
    });

  expect(
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.install.watch"])(progress)
  ).toEqual(progress);
  expect(() => Schema.decodeUnknownSync(P.WatchLanguageInstall.successSchema)(progress)).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.install.watch"])({
      ...progress,
      sequence: -1,
    })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.install.watch"])({
      ...progress,
      message: "x".repeat(65537),
    })
  ).toThrow();
});

test("context IPC items decode individual events, not the RPC Stream wrapper", () => {
  expect(
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.context.watch"])(event)
  ).toEqual(event);
  expect(() => Schema.decodeUnknownSync(P.WatchLanguageContext.successSchema)(event)).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.context.watch"])({
      ...event,
      context: { ...context, generation: 0 },
    })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.context.watch"])([event])
  ).toThrow();
});

test("availability IPC items decode bounded arrays and reject malformed/oversize items", () => {
  const empty: LanguageSubscriptionItem<"languages.availability.watch"> = [];
  expect(
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.availability.watch"])(empty)
  ).toEqual([]);
  expect(() =>
    Schema.decodeUnknownSync(P.WatchLanguageAvailability.successSchema)(empty)
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.availability.watch"])([{}])
  ).toThrow();

  const maximum: LanguageSubscriptionItem<"languages.availability.watch"> = Array.from(
    { length: 512 },
    () => availability
  );

  expect(
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.availability.watch"])(maximum)
  ).toHaveLength(512);
  expect(() =>
    Schema.decodeUnknownSync(LanguageSubscriptionItems["languages.availability.watch"])([
      ...maximum,
      availability,
    ])
  ).toThrow();
});
