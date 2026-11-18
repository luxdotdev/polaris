import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@polaris/ui";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import type {
  PolarisAccountsView,
  PolarisAccountView,
} from "../../../../shared/accountsContract.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { hostView } from "../../../routes/fixtures.testing.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { PolarisAccountsPage } from "./PolarisAccountsPage.tsx";

let fake: FakeBridge;

beforeEach(() => {
  fake = installFakeBridge();
});

afterEach(() => {
  cleanup();
  standInBridge(null);
});

const DAY = 86_400_000;

const account = (id: string, login: string, extra: Partial<PolarisAccountView> = {}) => ({
  id,
  server: "https://auth.polaris.lux.dev",
  serverLabel: "Polaris Cloud",
  isPolarisCloud: true,
  login,
  name: null,
  avatar: null,
  commitEmail: `${login}@lux.dev`,
  commitEmails: [`${login}@lux.dev`, `${login}@users.noreply.github.com`],
  signedInAt: Date.now() - 12 * DAY,
  signedOutAt: null,
  ...extra,
});

const view = (extra: Partial<PolarisAccountsView> = {}): PolarisAccountsView => ({
  storageAvailable: true,
  accounts: [
    account("a1", "lucasdoell"),
    account("a2", "lucas-acme", {
      server: "https://auth.acme.dev",
      serverLabel: "auth.acme.dev",
      isPolarisCloud: false,
    }),
  ],
  workspaces: { "mac/w1": "a1" },
  signIn: null,
  failure: null,
  ...extra,
});

const mount = (accounts: PolarisAccountsView) => {
  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: [{ ...hostView("mac"), label: "Mac Studio" }],
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  render(
    <AppProvider
      value={{
        connection,
        navigation: createNavigation({ app: store, storage: null }),
        commands: createCommandRegistry({ platform: "mac" }),
      }}
    >
      <TooltipProvider>
        <PolarisAccountsPage />
      </TooltipProvider>
    </AppProvider>
  );

  act(() => {
    fake.feeds("accounts")[0]?.listener.items([accounts]);
  });
};

test("each Account names its server: Polaris Cloud by name, one of your own by URL", () => {
  mount(view());
  const [cloud, own] = screen.getAllByTestId("polaris-account");

  expect(within(cloud ?? document.body).getByText("Polaris Cloud")).not.toBeNull();
  expect(within(cloud ?? document.body).getByText("auth.polaris.lux.dev")).not.toBeNull();
  expect(within(own ?? document.body).getByText("Own server")).not.toBeNull();
  expect(within(own ?? document.body).getByText("https://auth.acme.dev")).not.toBeNull();
  expect(screen.getByText("2 signed in on this Mac")).not.toBeNull();
});

test("Add account signs in to Polaris Cloud unless you give your own server", () => {
  mount(view());

  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  });
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
  });
  act(() => {
    fireEvent.click(screen.getByRole("radio", { name: /Use your own server/ }));
  });

  const signIn = screen.getByRole("button", { name: "Sign in with GitHub" });

  expect(signIn.hasAttribute("disabled")).toBeTrue();
  act(() => {
    fireEvent.change(screen.getByLabelText("Account server URL"), {
      target: { value: " https://auth.acme.dev " },
    });
  });
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Use a code instead" }));
  });
  act(() => {
    fireEvent.click(signIn);
  });

  expect(fake.sent("accounts.signIn.start")).toEqual([{}, { server: "https://auth.acme.dev" }]);
  expect(fake.sent("accounts.signIn.device")).toEqual([{ server: "https://auth.acme.dev" }]);
});

test("a device code shows large with its sign-in page; a failed sign-in says why", () => {
  mount(
    view({
      signIn: {
        kind: "device",
        server: "https://auth.polaris.lux.dev",
        userCode: "WDJB-MJHT",
        verificationUri: "https://auth.polaris.lux.dev/device?user_code=WDJB-MJHT",
        expiresAt: Date.now() + 5 * 60_000,
        failure: null,
      },
    })
  );

  expect(screen.getByTestId("polaris-account-code").textContent).toBe("WDJB-MJHT");
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: /Open the sign-in page/ }));
  });
  expect(fake.sent("shell.openExternal")).toEqual([
    { url: "https://auth.polaris.lux.dev/device?user_code=WDJB-MJHT" },
  ]);
});

test("a signed-out Account offers Sign in again instead of its commit email", () => {
  mount(view({ accounts: [account("a1", "lucasdoell", { signedOutAt: Date.now() - 2 * DAY })] }));
  const [row] = screen.getAllByTestId("polaris-account");
  const scoped = within(row ?? document.body);

  expect(scoped.getByText(/Signed out · the server ended its session 2 days ago/)).not.toBeNull();
  expect(scoped.queryByLabelText("Commit email for @lucasdoell")).toBeNull();
  act(() => {
    fireEvent.click(scoped.getByRole("button", { name: "Sign in again" }));
  });
  expect(screen.getByTestId("add-polaris-account")).not.toBeNull();
});

test("with no Account, the page offers only Add account: no sharing per workspace", () => {
  mount(view({ accounts: [], workspaces: {} }));

  expect(screen.getByText("No Polaris account on this Mac yet")).not.toBeNull();
  expect(screen.queryByText("Sharing account per workspace")).toBeNull();
});

test("Add account closes once the new Account arrives", () => {
  mount(view());

  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  });
  expect(screen.queryByTestId("add-polaris-account")).not.toBeNull();
  act(() => {
    fake
      .feeds("accounts")[0]
      ?.listener.items([view({ accounts: [...view().accounts, account("a3", "hubot")] })]);
  });
  expect(screen.queryByTestId("add-polaris-account")).toBeNull();
});
