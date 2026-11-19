import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import type { HostView } from "../../../../shared/api.ts";
import type { AppUpdateView } from "../../../../shared/appUpdates.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { hostView } from "../../../routes/fixtures.testing.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { type AppState, initialState } from "../../../store/store.ts";
import { updatesStore } from "../updates/store.ts";
import { DEFAULT_DEVELOPER_MODE, DeveloperMode, WorkspaceId } from "@polaris/protocol";
import { DEFAULT_SESSION_PREFS } from "../../../../shared/sessionPrefs.ts";
import { developerModes } from "../developerModeSync.ts";
import { settingsStore } from "../store.ts";
import { AboutPage } from "./AboutPage.tsx";

afterEach(() => {
  cleanup();
  updatesStore.setState({ view: null, problem: null, changing: false });
  developerModes.setState({}, true);
  settingsStore.setState({ sessions: DEFAULT_SESSION_PREFS, developmentBuild: false });
});

const view = (patch: Partial<AppUpdateView> = {}): AppUpdateView => ({
  phase: "current",
  version: "0.5.0",
  availableVersion: null,
  readyVersion: null,
  download: null,
  failure: null,
  automatic: true,
  lastCheckedAt: null,
  installId: "7c1e0000-0000-0000-0000-00000000a40b",
  osVersion: "27.0",
  platform: "darwin",
  arch: "arm64",
  supported: true,
  ...patch,
});

/** A connected host whose daemon reports `daemonVersion`. */
const daemonHost = (key: string, daemonVersion: string): HostView => {
  const base = hostView(key);

  return {
    ...base,
    status: {
      ...base.status,
      // SAFETY: the page reads only daemonVersion from HostInfo.
      host: { daemonVersion } as NonNullable<HostView["status"]["host"]>,
    },
  };
};

const mount = (updates: AppUpdateView, hosts: ReadonlyArray<HostView> = []) => {
  updatesStore.setState({ view: updates });
  const store = createStore<AppState>(() => ({ ...initialState, hosts }));
  const navigation = createNavigation({ app: store, storage: null });

  render(
    <AppProvider
      value={{
        connection: {
          store,
          openSession: () => () => undefined,
          setDensity: () => undefined,
          setAppearance: () => undefined,
        },
        navigation,
        commands: createCommandRegistry({ platform: "mac" }),
      }}
    >
      <AboutPage />
    </AppProvider>
  );

  return navigation;
};

test.each(["0.5.0", "1.2.3-beta.4"])(
  "the title names the version the running app reports: %s",
  (version) => {
    mount(view({ version }));

    expect(screen.getByTestId("about-version").textContent).toBe(`Polaris ${version}`);
  }
);

test("a daemon older than the app says it can upgrade, and the aside counts the current ones", () => {
  const navigation = mount(view({ version: "0.5.0" }), [
    daemonHost("studio", "0.5.0"),
    daemonHost("pi", "0.4.2"),
    hostView("vm", "offline"),
  ]);

  const card = within(screen.getByTestId("about-daemons"));

  expect(card.getAllByTestId("daemon-version").map((el) => el.textContent)).toEqual([
    "0.5.0",
    "0.4.2 · upgrade",
  ]);
  expect(card.getByText("1 of 2 current")).not.toBeNull();
  expect(card.getByText("Not connected")).not.toBeNull();

  fireEvent.click(card.getByRole("button", { name: "Open hosts" }));
  expect(navigation.store.getState().settings?.section).toBe("hosts");
});

test("the ready state offers Restart to update, and Check now waits until after the restart", () => {
  mount(
    view({ phase: "ready", availableVersion: "0.5.1", readyVersion: "0.5.1", lastCheckedAt: 0 })
  );

  expect(screen.getByRole("button", { name: "Restart to update" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "Check now" }).hasAttribute("disabled")).toBe(true);
});

test("a download shows its amount and a bar at its share; a failed one has neither", () => {
  const MB = 1_000_000;

  mount(
    view({
      phase: "downloading",
      availableVersion: "0.12.1",
      download: { version: "0.12.1", receivedBytes: 48 * MB, totalBytes: 131 * MB },
    })
  );

  const row = within(screen.getByTestId("app-update"));
  const bar = row.getByRole("progressbar", { name: "Downloading Polaris 0.12.1" });

  expect(row.getByText("48 of 131 MB · 37%")).not.toBeNull();
  expect(bar.getAttribute("aria-valuenow")).toBe("37");
  expect(row.queryByRole("button")).toBeNull();
  cleanup();

  mount(
    view({
      phase: "failed",
      failure: { stage: "download", version: "0.12.1", percent: 61 },
    })
  );

  const failed = within(screen.getByTestId("app-update"));

  expect(failed.getByText("Couldn't download Polaris 0.12.1")).not.toBeNull();
  expect(failed.queryByRole("progressbar")).toBeNull();
  expect(failed.getByRole("button", { name: "Try again" })).not.toBeNull();
});

test("checking shows the spinner and offers nothing to press in the row", () => {
  mount(view({ phase: "checking" }));

  const row = within(screen.getByTestId("app-update"));

  expect(row.getByText("Checking for updates…")).not.toBeNull();
  expect(row.getByTestId("app-update-spinner")).not.toBeNull();
  expect(row.queryByRole("button")).toBeNull();
});

test("with automatic checks off, the install ID is not sent", () => {
  mount(view({ automatic: false }));

  const fields = within(screen.getByTestId("update-fields"));

  expect(fields.getByText("Not sent while automatic checks are off")).not.toBeNull();
  expect(fields.queryByText(/7c1e/)).toBeNull();
});

const developerSwitch = () =>
  within(screen.getByTestId("about-developer-mode")).getByRole("switch", {
    name: /Developer mode/,
  });

test("Developer Mode is off by default, and the switch turns it on for every host", () => {
  mount(view());

  expect(developerSwitch().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(developerSwitch());

  expect(settingsStore.getState().sessions.developerMode).toBe(true);
  expect(developerSwitch().getAttribute("aria-checked")).toBe("true");
});

test("in Polaris Dev the switch is on and locked, whatever the setting says", () => {
  settingsStore.setState({ developmentBuild: true });
  mount(view());

  expect(developerSwitch().getAttribute("aria-checked")).toBe("true");
  expect(developerSwitch().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/On in Polaris Dev/)).not.toBeNull();

  fireEvent.click(developerSwitch());
  expect(settingsStore.getState().sessions.developerMode).toBe(false);
});

test("each host shows its Polaris workspace and how it was found", () => {
  const studio = hostView("studio");
  const pi = hostView("pi");

  const withMode = (h: HostView): HostView => ({
    ...h,
    status: { ...h.status, capabilities: ["developer-mode"] },
  });

  developerModes.setState({
    studio: {
      kind: "mode",
      mode: DeveloperMode.make({
        stored: false,
        leases: 0,
        fromSource: false,
        effective: false,
        polarisWorkspaceId: WorkspaceId.make("polaris"),
        polarisWorkspaceSource: "remote",
      }),
    },
    pi: { kind: "mode", mode: DEFAULT_DEVELOPER_MODE },
  });
  mount(view(), [withMode(studio), withMode(pi), hostView("old")]);

  const card = within(screen.getByTestId("about-developer-mode"));

  expect(card.getByText("polaris · by git remote")).not.toBeNull();
  expect(card.getByText("No polaris workspace found")).not.toBeNull();
  expect(card.queryByText("old")).toBeNull();
});
