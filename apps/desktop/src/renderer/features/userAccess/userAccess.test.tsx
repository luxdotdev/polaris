import "../../test/dom.testing.ts";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Toaster } from "@polaris/ui";
import { UserAccessId } from "@polaris/protocol";
import { createStore } from "zustand/vanilla";
import type { HostView, MachineView } from "../../../shared/api.ts";
import type { UserAccessView } from "../../../shared/userAccessContract.ts";
import { createCommandRegistry } from "../../routes/commands.ts";
import { hostView } from "../../routes/fixtures.testing.ts";
import { createNavigation } from "../../routes/navigation.ts";
import { AppProvider } from "../../shell/hooks.ts";
import { noteHostKinds } from "../../store/hostKinds.ts";
import { type AppState, initialState } from "../../store/store.ts";
import { type FakeBridge, installFakeBridge } from "../../test/bridge.testing.ts";
import { refusalText } from "../session/dispatch.ts";
import { DesktopAppsCard, UserAccessNotice } from "./DesktopAppsCard.tsx";
import { CAPABILITY } from "./model.ts";
import { setUserAccess, userAccess } from "./store.ts";
import { resetUserAccessWatcher, UserAccessWatcher } from "./Watcher.tsx";

let fake: FakeBridge;

beforeEach(() => {
  resetUserAccessWatcher();
  userAccess.setState({}, true);
  fake = installFakeBridge();
});

afterEach(() => {
  cleanup();
  userAccess.setState({}, true);
});

const NOW = Date.parse("2026-11-16T12:00:00Z");

const studio = {
  id: UserAccessId.make("1".repeat(16)),
  label: "Mac Studio",
  enrolledAt: "2026-11-13T12:00:00Z",
};

const laptop = {
  id: UserAccessId.make("2".repeat(16)),
  label: "MacBook Pro",
  enrolledAt: "2026-11-16T11:58:00Z",
};

const request = { ...laptop, code: "4F2-91C", requestedAt: "2026-11-16T11:59:00Z" };

const app = (value: typeof studio, connected: boolean) => ({ ...value, self: false, connected });

const held = (requests: ReadonlyArray<typeof request> = []): UserAccessView => ({
  standing: "held",
  code: null,
  enrolled: [{ ...studio, self: true, connected: true }, app(laptop, false)],
  requests,
});

const waiting: UserAccessView = {
  standing: "waiting",
  code: "4F2-91C",
  enrolled: [],
  requests: [],
};

const denied: UserAccessView = { standing: "none", code: null, enrolled: [], requests: [] };

const machine: MachineView = {
  daemon: null,
  key: "pi",
  kind: "ssh",
  label: "lucas-rpi",
  colour: null,
  alias: "lucas-rpi",
  target: null,
  enabled: true,
  forwardAgent: false,
  remoteCommand: null,
  status: null,
  install: null,
};

const host = (capabilities: ReadonlyArray<string>, epoch = 1): HostView => {
  const base = hostView("pi");

  // SAFETY: the test names capabilities as the Daemon announces them.
  return {
    ...base,
    label: "lucas-rpi",
    status: { ...base.status, capabilities: [...capabilities], epoch },
  } as HostView;
};

const watch = (hosts: ReadonlyArray<HostView>) => {
  const store = createStore<AppState>(() => ({ ...initialState, hosts }));

  render(
    <AppProvider
      value={{
        connection: {
          store,
          openSession: () => () => undefined,
          setDensity: () => undefined,
          setAppearance: () => undefined,
        },
        navigation: createNavigation({ app: store, storage: null }),
        commands: createCommandRegistry({ platform: "mac" }),
      }}
    >
      <UserAccessWatcher />
      <Toaster />
    </AppProvider>
  );

  return (next: ReadonlyArray<HostView>) => act(() => store.setState({ hosts: next }));
};

const feed = () => {
  const opened = fake.feeds("userAccess.watch").at(-1);

  if (opened === undefined) throw new Error("no user access feed was opened");

  return opened;
};

test("a desktop app that holds user access is asked about a new one once, and Allow enrols it", async () => {
  const sent: Array<unknown> = [];

  fake.answer("userAccess.allow", (input) => {
    sent.push(input);

    return { ok: true, value: app(laptop, true) };
  });
  watch([host([CAPABILITY])]);

  act(() => feed().listener.items([held([request])]));
  act(() => feed().listener.items([held([request])]));

  const titles = await screen.findAllByText("Allow MacBook Pro on lucas-rpi?");

  expect(titles).toHaveLength(1);
  expect(
    screen.getByText(
      "Only if it shows 4F2-91C. It can then approve, send turns and start agent sessions on lucas-rpi."
    )
  ).toBeDefined();

  act(() => screen.getByRole("button", { name: "Allow" }).click());

  await waitFor(() => expect(sent).toEqual([{ hostKey: "pi", id: laptop.id }]));
});

test("a request answered on another desktop app takes its toast down here", async () => {
  watch([host([CAPABILITY])]);
  act(() => feed().listener.items([held([request])]));
  await screen.findByText("Allow MacBook Pro on lucas-rpi?");

  act(() => feed().listener.items([held()]));

  // Dismissed: the toaster marks it removed, then unmounts it after its exit.
  await waitFor(() => {
    const toast = screen
      .queryByText("Allow MacBook Pro on lucas-rpi?")
      ?.closest("[data-sonner-toast]");

    expect(toast?.getAttribute("data-removed") ?? "true").toBe("true");
  });
});

test("a waiting desktop app is not asked about anyone, and a host without enrolment opens no feed", () => {
  const set = watch([host([])]);

  expect(fake.feeds("userAccess.watch")).toHaveLength(0);

  set([host([CAPABILITY])]);
  act(() => feed().listener.items([waiting]));

  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  expect(userAccess.getState().pi?.standing).toBe("waiting");
});

test("the host page lists the allowed desktop apps, this one marked, and who is asking with its code", () => {
  setUserAccess("pi", held([request]));
  const { container } = render(<DesktopAppsCard machine={machine} now={NOW} />);
  const text = container.textContent ?? "";

  expect(text).toContain("2 allowed · 1 asking");
  expect(text).toContain("MacBook Pro is asking");
  expect(text).toContain("Allow it only if it shows 4F2-91C");
  expect(text).toContain("This desktop app · allowed 3d ago");
  expect(text).toContain("allowed 2m ago");
});

test("revoking asks in place with what stops, then revokes that desktop app", async () => {
  const sent: Array<unknown> = [];

  fake.answer("userAccess.revoke", (input) => {
    sent.push(input);

    return { ok: true, value: app(laptop, false) };
  });
  setUserAccess("pi", held());
  render(<DesktopAppsCard machine={machine} now={NOW} />);

  act(() => screen.getAllByRole("button", { name: "Revoke" })[1]?.click());

  expect(
    screen.getByText(
      "MacBook Pro stops approving, sending turns and starting agent sessions on lucas-rpi now. It can ask again."
    )
  ).toBeDefined();
  expect(sent).toEqual([]);

  act(() => screen.getByRole("button", { name: "Revoke MacBook Pro" }).click());

  await waitFor(() => expect(sent).toEqual([{ hostKey: "pi", id: laptop.id }]));
});

test("a waiting desktop app shows its code and no list; one that holds access shows no notice", () => {
  setUserAccess("pi", waiting);

  const page = render(
    <>
      <UserAccessNotice machine={machine} />
      <DesktopAppsCard machine={machine} now={NOW} />
    </>
  );

  expect(page.container.textContent).toBe(
    "This desktop app is waiting to be allowed on lucas-rpi. Until then it can't approve, send turns or start agent sessions there. Allow it from a desktop app that already uses lucas-rpi; it shows the same code.4F2-91C"
  );

  act(() => setUserAccess("pi", held()));

  expect(page.queryByTestId("user-access-notice")).toBeNull();
});

test("a refused approval says who allows this desktop app, or how to ask again", () => {
  noteHostKinds([{ key: "pi", kind: "ssh", label: "lucas-rpi" }]);

  const refused = {
    code: "UserAccessRequired",
    message: "dispatch:RespondToApproval is only for a Desktop App this Host has enrolled",
  };

  setUserAccess("pi", waiting);
  expect(refusalText(refused, "pi")).toBe(
    "This desktop app can't approve on lucas-rpi yet. Allow it from a desktop app that already uses lucas-rpi; both show the code 4F2-91C."
  );

  setUserAccess("pi", denied);
  expect(refusalText(refused, "pi")).toBe(
    "This desktop app isn't allowed to approve on lucas-rpi. Reconnect to lucas-rpi to ask again."
  );
});
