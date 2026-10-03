import { describe, expect, test } from "bun:test";
import type { AppUpdateView } from "../../../../shared/appUpdates.ts";
import { appUpdateRow } from "./model.ts";

const view = (patch: Partial<AppUpdateView> = {}): AppUpdateView => ({
  phase: "idle",
  version: "0.4.0",
  availableVersion: null,
  automatic: true,
  lastCheckedAt: null,
  installId: "58baf1dc-3772-4353-86b3-3a8a49219521",
  macOSVersion: "26.1",
  arch: "arm64",
  supported: true,
  ...patch,
});

describe("About Update states", () => {
  test("available metadata is absent until macOS finishes downloading", () => {
    expect(appUpdateRow(view({ phase: "downloading" }))).toMatchObject({
      title: "Downloading Polaris",
      glyph: "working",
      action: null,
    });
    expect(appUpdateRow(view({ phase: "blocked" }))).toMatchObject({
      title: "Polaris can't install here",
      action: "finder",
    });
  });
  test("checks off still lets the user check, and retains ready updates", () => {
    expect(appUpdateRow(view({ automatic: false }))).toMatchObject({
      title: "Automatic checks are off",
      action: "check",
    });
    expect(
      appUpdateRow(view({ automatic: false, phase: "ready", availableVersion: "0.5.0" }))
    ).toMatchObject({
      title: "Polaris 0.5.0 is ready",
      action: "restart",
      caption: "Installs when you restart or quit; agent sessions keep working",
    });
  });
  test("failures stay neutral and never promise an automatic retry with checks off", () => {
    expect(appUpdateRow(view({ phase: "failed", automatic: false }))).toMatchObject({
      glyph: "failed",
      actionLabel: "Try again",
    });
    expect(appUpdateRow(view({ phase: "failed", automatic: false })).caption).not.toContain(
      "6 hours"
    );
  });
  test("working states offer no second action", () => {
    for (const phase of ["checking", "downloading"] as const)
      expect(appUpdateRow(view({ phase })).action).toBeNull();
  });
});
