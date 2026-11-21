import "../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { createStore } from "zustand/vanilla";
import { createCommandInstaller } from "../../../main/commandInstall.ts";
import { RequestInputs } from "../../../shared/contract.ts";
import type { PolarisApi } from "../../../shared/api.ts";
import { createCommandRegistry } from "../../routes/commands.ts";
import { createNavigation } from "../../routes/navigation.ts";
import { AppProvider } from "../../shell/hooks.ts";
import { initialState } from "../../store/store.ts";
import { standInBridge } from "../bridge.ts";
import { CommandInstallCard, CommandInstallSetup } from "./CommandInstall.tsx";
import { commandInstallStore } from "./store.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "command-ui-"));
  const target = join(home, ".polaris/bin/current/polaris");
  mkdirSync(join(home, ".polaris/bin/current"), { recursive: true });
  writeFileSync(target, "#!/bin/sh\n");
  chmodSync(target, 0o755);
  commandInstallStore.setState({ view: null, problem: null, busy: false });
});

afterEach(() => {
  cleanup();
  standInBridge(null);
  rmSync(home, { recursive: true, force: true });
});

const mount = () => {
  let dismissed = false;

  const installer = createCommandInstaller({
    userHome: home,
    platform: "darwin",
    path: () => "/usr/bin",
    dismissed: () => dismissed,
    dismiss: () => {
      dismissed = true;
    },
  });

  const api: PolarisApi = {
    request: (method, input) => {
      const run = async () => {
        if (method === "commandInstall.get") return installer.get();

        if (method === "commandInstall.dismiss") return installer.dismiss();

        const { action, location } = Schema.decodeUnknownSync(
          RequestInputs["commandInstall.change"]
        )(input);

        return installer.change(action, location);
      };

      // SAFETY: these components request only CommandInstallView-returning methods.
      return run().then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: { code: "Failed", message: String(error) } })
      ) as never;
    },
    subscribe: () => () => {},
    onAppEvent: () => () => {},
  };

  standInBridge(api);
  const store = createStore(() => initialState);
  const navigation = createNavigation({ app: store, storage: null });
  const commands = createCommandRegistry({ platform: "mac" });
  render(
    <AppProvider
      value={{
        connection: {
          store,
          openSession: () => () => {},
          setDensity: () => {},
          setAppearance: () => {},
        },
        navigation,
        commands,
      }}
    >
      <CommandInstallSetup />
      <CommandInstallCard />
    </AppProvider>
  );

  return { commands, navigation };
};

test("first-run install creates a real link, shows PATH guidance, and palette uninstall removes it", async () => {
  const { commands } = mount();
  const install = await screen.findByRole("button", { name: "Install polaris command" });
  await act(async () => {
    fireEvent.click(install);
  });
  expect(screen.getByRole("button", { name: "Uninstall" })).not.toBeNull();
  expect(readlinkSync(join(home, ".local/bin/polaris"))).toBe(
    join(home, ".polaris/bin/current/polaris")
  );
  expect(screen.getByText(/Add/).textContent).toContain("PATH");
  expect(commands.palette().some((row) => row.title === "Uninstall polaris command")).toBe(true);
  await act(async () => {
    commands.runAny("command.uninstall.user");
  });
  expect(screen.getByRole("button", { name: "Install" })).not.toBeNull();
  expect(commandInstallStore.getState().view?.links[0]?.state).toBe("absent");
  expect(screen.queryByRole("region", { name: "Command line setup" })).toBeNull();
});

test("Not now dismisses the first-run offer while Settings and command menu keep Install", async () => {
  const { commands, navigation } = mount();
  const dismiss = await screen.findByRole("button", { name: "Not now" });
  await act(async () => {
    fireEvent.click(dismiss);
  });
  expect(screen.queryByRole("region", { name: "Command line setup" })).toBeNull();
  expect(screen.getByRole("button", { name: "Install" }).hasAttribute("disabled")).toBe(false);
  let choose: (() => void) | undefined;
  commands.onFollowUp((step) => {
    choose = step.choices[0]?.run;
  });
  expect(commands.runAny("command.install")).toBe(true);
  expect(choose).not.toBeUndefined();
  await act(async () => {
    choose?.();
  });
  expect(navigation.store.getState().settings?.section).toBe("about");
  expect(screen.getByRole("button", { name: "Uninstall" })).not.toBeNull();
});
