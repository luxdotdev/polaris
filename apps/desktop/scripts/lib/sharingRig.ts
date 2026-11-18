/**
 * What `sharingE2e.ts` stands on: the local Account Server and relay (`sharingServers.ts`), two
 * app instances with their own Daemons and user data, and the gestures both people make.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ElectronApplication, Page } from "playwright-core";
import { startDaemon, type TestDaemon } from "./daemon.ts";
import { scriptedElectron as electron, APP_DIR, electronBinary, sizeWindow } from "./electron.ts";
import { MOCK_KEYCHAIN } from "./githubFlow.ts";

export interface Servers {
  readonly server: string;
  readonly relay: string;
  readonly browser: string;
  readonly stop: () => void;
}

/** The Account Server (fake GitHub), the relay and the stand-in browser, on this machine only. */
export const startServers = async (): Promise<Servers> => {
  const helper = spawn("bun", [join(APP_DIR, "scripts/lib/sharingServers.ts")], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  const ready = await new Promise<string>((resolve, reject) => {
    const lines = createInterface({ input: helper.stdout });

    lines.on("line", (line) => {
      if (line.startsWith("SHARING ")) resolve(line.slice("SHARING ".length));
    });
    helper.once("exit", (code) => reject(new Error(`sharing servers exited ${code}`)));
  });

  // SAFETY: lib/sharingServers.ts prints exactly this shape after "SHARING ".
  const urls = JSON.parse(ready) as Pick<Servers, "server" | "relay" | "browser">;

  return { ...urls, stop: () => helper.stdin.end() };
};

export interface Person {
  readonly name: "owner" | "teammate";
  readonly login: string;
  readonly label: string;
  readonly app: ElectronApplication;
  readonly page: Page;
  /** Restarted in step 8, so the current one is read through the person. */
  daemon: TestDaemon;
  readonly daemonHome: string;
}

/** A short home: a Daemon's Unix socket path has a length limit the system tmpdir can pass. */
export const newHome = () => mkdtempSync("/tmp/pl-share-");

export const startPersonDaemon = (daemonHome: string) =>
  startDaemon({ home: daemonHome, benchHarness: true, fileSecrets: true });

export const launch = async (input: {
  readonly home: string;
  readonly servers: Servers;
  readonly name: Person["name"];
  readonly login: string;
  readonly label: string;
}): Promise<Person> => {
  const { home, servers, name, login, label } = input;
  const daemonHome = join(home, `${name}-d`);
  const daemon = await startPersonDaemon(daemonHome);
  const userData = join(home, `${name}-ud`);

  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, "settings.json"),
    JSON.stringify({ theme: "dark", density: "balanced", welcomeSeen: true })
  );

  const app = await electron.launch({
    executablePath: electronBinary(),
    args: [APP_DIR, MOCK_KEYCHAIN],
    env: {
      ...process.env,
      POLARIS_DESKTOP_LOCAL_SOCKET: daemon.socketPath,
      POLARIS_DESKTOP_BENCH_HARNESS: "1",
      POLARIS_DESKTOP_LOCAL_LABEL: label,
      POLARIS_DESKTOP_USER_DATA: userData,
      POLARIS_DESKTOP_HIDDEN: "1",
      POLARIS_DESKTOP_RELAY_URL: servers.relay,
    },
  });

  // The system browser is the stand-in, signing this instance's person in.
  await app.evaluate(
    ({ shell }, { standIn, as }) => {
      shell.openExternal = async (url: string) => {
        const response = await fetch(`${standIn}/open?as=${as}&url=${encodeURIComponent(url)}`);

        if (!response.ok) throw new Error(await response.text());
      };
    },
    { standIn: servers.browser, as: login }
  );

  const page = await app.firstWindow();

  await sizeWindow(app, 1440, 900);
  await page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 30_000 });

  return { name, login, label, app, page, daemon, daemonHome };
};

interface Answer<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

/** What a bridge request takes: plain JSON. */
export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

/** A bridge request whose input is a JavaScript expression evaluated in the renderer. */
export const askSource = async <T = unknown>(
  page: Page,
  method: string,
  source: string
): Promise<Answer<T>> => {
  const result: unknown = await page.evaluate(
    `window.polaris.request(${JSON.stringify(method)}, ${source})`
  );

  // SAFETY: every bridge request answers `{ ok, value } | { ok: false, error }`.
  return result as Answer<T>;
};

/** A bridge request as the renderer makes it: its answer, refused or not. */
export const ask = <T = unknown>(page: Page, method: string, input: Json): Promise<Answer<T>> =>
  askSource<T>(page, method, JSON.stringify(input));

export const request = async <T = unknown>(page: Page, method: string, input: Json) => {
  const answer = await ask<T>(page, method, input);

  if (!answer.ok) throw new Error(`${method}: ${answer.error?.code} ${answer.error?.message}`);

  // SAFETY: an ok answer carries its value.
  return answer.value as T;
};

/** Signs in through Settings → Polaris accounts, on the local Account Server. */
export const signIn = async (person: Person, server: string) => {
  const { app, page, login } = person;

  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
  });
  await page.getByTestId("settings").waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Polaris accounts", exact: true }).click();

  if (!(await page.getByTestId("add-polaris-account").isVisible()))
    await page.getByRole("button", { name: "Add account" }).click();
  await page.getByRole("radio", { name: /Use your own server/ }).click();
  await page.getByLabel("Account server URL").fill(server);
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await page.getByTestId("polaris-account").filter({ hasText: login }).waitFor({ timeout: 20_000 });
};

export const closeSettings = (page: Page) => page.keyboard.press("Escape");

/** A bench Harness prompt: a quick Turn unless told otherwise. */
export const bench = (script: Readonly<Record<string, number>> = {}) =>
  `bench:${JSON.stringify({ items: 2, deltasPerItem: 2, deltaIntervalMs: 5, ...script })}`;

const type = async (page: Page, text: string, key: string) => {
  await page.getByTestId("composer-input").click();
  await page.keyboard.insertText(text);
  await page.keyboard.press(key);
};

/** Enter: a Turn, or a steer while one works. */
export const send = (page: Page, text: string) => type(page, text, "Enter");

/** ⌘↵: a follow-up into the shared session's queue. */
export const queue = (page: Page, text: string) => type(page, text, "Meta+Enter");

/** "Idle · turn 3", as the session header reads. */
export const headerState = async (page: Page): Promise<string> =>
  (await page.locator("body").innerText()).match(/Claude Code\n·\n([^\n]+)/)?.[1] ?? "";

/** Polls `read` until `done` or the deadline; the last value either way. */
export const until = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 20_000
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let value = await read();

  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }

  return value;
};

export const untilIdle = (page: Page, timeoutMs = 90_000) =>
  until(
    () => headerState(page),
    (state) => state.startsWith("Idle"),
    timeoutMs
  );

export const toasts = (page: Page) => page.locator("[data-slot=toast]").allInnerTexts();

/** The owner's two sessions in one Workspace: the one to share and one that stays private. */
export const createSessions = (page: Page, repo: string): Promise<ReadonlyArray<string>> =>
  page.evaluate(`(async () => {
    const api = window.polaris; const repo = ${JSON.stringify(repo)};
    const must = (r, what) => { if (!r.ok) throw new Error(what + ": " + r.error.message); return r.value; };
    const dispatch = (command) => api.request("dispatch", { hostKey: "local", commandId: crypto.randomUUID(), command }).then((r) => must(r, command._tag));
    await dispatch({ _tag: "RegisterWorkspace", path: repo, name: "polaris" });
    const workspaceId = await new Promise((resolve) => {
      const close = api.subscribe("host", { hostKey: "local" }, { items: (items) => {
        for (const i of items) {
          const all = i._tag === "Snapshot" ? i.workspaces : i._tag === "Event" && i.envelope.event._tag === "WorkspaceRegistered" ? [i.envelope.event.workspace] : [];
          const found = all.find((w) => w.path === repo);
          if (found) { close(); resolve(found.id); return; }
        } } });
    });
    const start = async (title, prompt) => {
      const sessionId = crypto.randomUUID();
      await dispatch({ _tag: "StartSession", sessionId, workspaceId, harness: "claude", placement: { _tag: "InPlace" }, permissionMode: "auto", model: null, effort: null, prompt, attachments: [] });
      await dispatch({ _tag: "RenameSession", sessionId, title });
      return sessionId;
    };
    return [
      await start("Fix the login redirect", ${JSON.stringify(bench({ touchFiles: 1 }))}),
      await start("Private notes", ${JSON.stringify(bench())}),
    ];
  })()`);

export interface Check {
  readonly step: number;
  readonly what: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface Rig {
  readonly out: string;
  readonly home: string;
  readonly repo: string;
  readonly servers: Servers;
  readonly owner: Person;
  readonly teammate: Person;
  /** [shared, private]. */
  sessions: ReadonlyArray<string>;
  readonly checks: Array<Check>;
}

export const log = (line: string) => console.log(`sharing-e2e: ${line}`);

/** Records one expectation of a step and carries on, so every step reports. */
export const check = (rig: Rig, step: number, what: string, pass: boolean, detail = "") => {
  rig.checks.push({ step, what, pass, detail });
  log(`${pass ? "pass" : "FAIL"} · step ${step} · ${what}${detail === "" ? "" : ` · ${detail}`}`);
};

/** A step that throws fails as a whole, and the next one still runs. */
export const runStep = async (rig: Rig, step: number, title: string, body: () => Promise<void>) => {
  log(`step ${step}: ${title}`);

  try {
    await body();
  } catch (error) {
    check(
      rig,
      step,
      `${title} ran to its end`,
      false,
      String(error).replaceAll(/\s+/g, " ").slice(0, 300)
    );
    await shoot(rig, rig.owner, `s${step}-failed-owner`).catch(() => undefined);
    await shoot(rig, rig.teammate, `s${step}-failed-teammate`).catch(() => undefined);
  }
};

/** Dark and light at Balanced density, then back to dark. */
export const shoot = async (rig: Rig, person: Person, name: string) => {
  for (const theme of ["dark", "light"]) {
    await request(person.page, "settings.setAppearance", { patch: { theme, density: "balanced" } });
    await person.page.waitForTimeout(500);
    await person.page.screenshot({ path: join(rig.out, `${name}-${theme}.png`) });
  }

  await request(person.page, "settings.setAppearance", {
    patch: { theme: "dark", density: "balanced" },
  });
};

/** The share sheet with @hubot filled in and `role` chosen; the caller submits. */
export const openShareSheet = async (page: Page, role: "Contributor" | "Commenter") => {
  if (!(await page.getByTestId("share-sheet").isVisible()))
    await page.getByTestId("share-session").click();
  await page.getByTestId("share-sheet").waitFor();
  await page.getByLabel("GitHub handle").fill("@hubot");
  await page.getByRole("radio", { name: role, exact: true }).click();
};

export const submitShare = async (page: Page) => {
  await page.getByTestId("share-submit").click();
  await page.getByTestId("share-person").filter({ hasText: /hubot/i }).waitFor({ timeout: 15_000 });
};

/** The Teammate's Invite in Shared with you, once the Account Server lists it. */
export const waitingInvite = async (page: Page) => {
  await request(page, "sharing.invites.refresh", {});
  const invite = page.getByTestId("share-invite").filter({ hasText: "Fix the login redirect" });

  await invite.waitFor({ timeout: 20_000 });

  return invite;
};

export const sharedLine = async (page: Page): Promise<string> => {
  const text = await page.locator("body").innerText();
  const at = text.indexOf("Shared with you");

  return at === -1 ? "" : text.slice(at, at + 130).replaceAll("\n", " | ");
};
