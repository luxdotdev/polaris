import { describe, expect, test } from "bun:test";
import type { AppUpdateView } from "../../../../shared/appUpdates.ts";
import { appUpdateRow, updateValues } from "./model.ts";

const view = (patch: Partial<AppUpdateView> = {}): AppUpdateView => ({
  phase: "idle",
  version: "0.4.0",
  availableVersion: null,
  readyVersion: null,
  download: null,
  failure: null,
  automatic: true,
  lastCheckedAt: null,
  installId: "58baf1dc-3772-4353-86b3-3a8a49219521",
  osVersion: "26.1",
  arch: "arm64",
  supported: true,
  ...patch,
});

const MB = 1_000_000;

describe("About Update states", () => {
  test("Windows install guidance names Setup.exe", () => {
    expect(appUpdateRow(view({ platform: "win32", phase: "blocked" })).caption).toBe(
      "Install Polaris with Setup.exe, then check again"
    );
    expect(appUpdateRow(view({ platform: "win32", supported: false })).title).toContain(
      "installed Windows app"
    );
  });

  test("the reveal action names each platform's file manager", () => {
    const label = (platform: string) =>
      appUpdateRow(view({ platform, phase: "blocked" })).actionLabel;

    expect(label("darwin")).toBe("Show in Finder");
    expect(label("win32")).toBe("Show in Explorer");
    expect(label("linux")).toBe("Show in folder");
  });

  test("a download names its Release and how far it is (Paper U1)", () => {
    const download = { version: "0.12.1", receivedBytes: 48 * MB, totalBytes: 131 * MB };

    expect(appUpdateRow(view({ phase: "downloading", download }))).toMatchObject({
      title: "Downloading Polaris 0.12.1",
      action: null,
      progress: { amount: "48 of 131 MB · 37%", fraction: (48 * MB) / (131 * MB) },
      tone: "default",
    });
    // Before the server says how large it is, there is an amount but no share to draw.
    expect(
      appUpdateRow(view({ phase: "downloading", download: { ...download, totalBytes: null } }))
        .progress
    ).toEqual({ amount: "48 MB", fraction: null });
    // Every byte is here; Squirrel is still checking it.
    expect(
      appUpdateRow(
        view({ phase: "downloading", download: { ...download, receivedBytes: 131 * MB } })
      )
    ).toMatchObject({
      caption: "Verifying the download",
      progress: { amount: "131 of 131 MB · 100%", fraction: 1 },
    });
    // 99.9% never rounds up to a finished download.
    expect(
      appUpdateRow(
        view({ phase: "downloading", download: { ...download, receivedBytes: 130.9 * MB } })
      ).progress?.amount
    ).toBe("131 of 131 MB · 99%");
  });
  test("a failed download says what happened, in the failed colour, and can be retried", () => {
    const failed = (failure: AppUpdateView["failure"]) =>
      appUpdateRow(view({ phase: "failed", failure }));

    expect(failed({ stage: "download", version: "0.12.1", percent: 61 })).toMatchObject({
      title: "Couldn't download Polaris 0.12.1",
      caption: "The connection dropped at 61%; Polaris tries again on the next check",
      actionLabel: "Try again",
      action: "check",
      tone: "failed",
    });
    expect(failed({ stage: "download", version: "0.12.1", percent: null }).caption).toBe(
      "The connection dropped; Polaris tries again on the next check"
    );
    expect(failed({ stage: "verify", version: "0.12.1", percent: null })).toMatchObject({
      title: "Couldn't download Polaris 0.12.1",
      caption: "The download didn't pass verification; Polaris tries again on the next check",
      tone: "failed",
    });
    // Squirrel went quiet with it: only a restart frees it, so there is nothing to press.
    expect(failed({ stage: "install", version: "0.12.1", percent: null })).toMatchObject({
      title: "Couldn't install Polaris 0.12.1",
      caption: "The installer didn't answer; restart Polaris to try again",
      action: null,
      tone: "failed",
    });
    // A feed that didn't answer stays neutral: nothing was downloaded.
    expect(failed({ stage: "check", version: null, percent: null })).toMatchObject({
      title: "Couldn't check for updates",
      tone: "default",
    });
  });
  test("the K menu gets the staged version and a download's line, and neither otherwise", () => {
    const download = { version: "0.12.1", receivedBytes: 48 * MB, totalBytes: 131 * MB };

    expect(updateValues(null)).toEqual({});
    expect(updateValues(view({ phase: "current" }))).toEqual({});
    expect(updateValues(view({ phase: "downloading", download }))).toEqual({
      updateProgress: "Downloading Polaris 0.12.1 · 48 of 131 MB · 37%",
    });
    expect(updateValues(view({ phase: "ready", readyVersion: "0.12.1" }))).toEqual({
      updateVersion: "0.12.1",
    });
  });
  test("a blocked install names no version it doesn't know", () => {
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
      title: "Couldn't check for updates",
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
  test("up to date names the running version and when it was checked (Paper U1)", () => {
    const at = new Date(2026, 10, 19, 14, 2).getTime();

    const row = (now: number) =>
      appUpdateRow(view({ phase: "current", version: "0.11.0", lastCheckedAt: at }), now);

    expect(row(at + 3 * 60 * 60_000)).toMatchObject({
      title: "Polaris 0.11.0 is up to date",
      caption: "Checked today at 14:02",
      actionLabel: "Check now",
    });
    // Yesterday's check is not "today".
    expect(row(at + 24 * 60 * 60_000).caption).toMatch(/^Checked \D+19 at 14:02$/);
  });
  test("only checking turns the spinner", () => {
    expect(appUpdateRow(view({ phase: "checking" })).spinner).toBe(true);

    for (const phase of ["idle", "current", "downloading", "ready", "failed"] as const)
      expect(appUpdateRow(view({ phase })).spinner).toBe(false);
  });
});
