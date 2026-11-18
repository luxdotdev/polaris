/**
 * Steps 6 to 9 of `sharingE2e.ts`: the co-author trailer, a role change and a revoke, the
 * owner's Host going offline and back, and what a Teammate must never reach.
 */
import { spawnSync } from "node:child_process";
import type { Page } from "playwright-core";
import {
  askSource,
  bench,
  check,
  headerState,
  type Json,
  openShareSheet,
  queue,
  type Rig,
  send,
  sharedLine,
  shoot,
  startPersonDaemon,
  submitShare,
  toasts,
  until,
  untilIdle,
  waitingInvite,
} from "./sharingRig.ts";

const commitLog = (repo: string) =>
  spawnSync("git", ["log", "--all", "--format=%an <%ae>%n%B"], { cwd: repo, encoding: "utf8" })
    .stdout;

const TRAILER = "Co-authored-by: Hubot <hubot@acme.example>";

export const stepCoAuthor = async (rig: Rig) => {
  const page = rig.owner.page;

  await page.getByRole("radio", { name: /^Review/ }).click();
  await page.getByText("Fix the login redirect").first().click();
  await page.getByTestId("session-review").waitFor({ timeout: 10_000 });
  await page.getByTestId("accept-primary").click();
  await page.getByTestId("accept-panel").waitFor({ timeout: 10_000 });
  await shoot(rig, rig.owner, "s6-owner-accept");

  // A theme change closes the popover.
  if (!(await page.getByTestId("accept-panel").isVisible()))
    await page.getByTestId("accept-primary").click();
  await page.getByTestId("accept-submit").click();

  const log = await until(
    () => Promise.resolve(commitLog(rig.repo)),
    (text) => text.includes(TRAILER),
    30_000
  );

  check(
    rig,
    6,
    "the commit of the Teammate's turns carries their Co-authored-by trailer",
    log.includes(TRAILER),
    log.split("\n").find((line) => line.startsWith("Co-authored-by")) ?? "no trailer in git log"
  );
  await page.getByRole("radio", { name: /^Orchestrate/ }).click();
  await page.getByText("Fix the login redirect").first().click();
  await page.getByTestId("session-title").waitFor({ timeout: 10_000 });
  await shoot(rig, rig.owner, "s6-owner-after-accept");
};

const bodyLength = async (page: Page) => (await page.locator("body").innerText()).length;

/** The Teammate right after the owner's Revoke: cut off, told so, and nothing streaming. */
const checkCutOff = async (rig: Rig) => {
  const { owner, teammate } = rig;

  const line = await until(
    () => sharedLine(teammate.page),
    (text) => text.includes("share ended"),
    15_000
  );

  check(
    rig,
    7,
    "a revoke reads share ended for the Teammate, not host offline",
    line.includes("share ended"),
    line
  );

  const notice = await teammate.page
    .getByTestId("share-ended")
    .innerText({ timeout: 5000 })
    .catch(() => "");

  check(
    rig,
    7,
    "the composer gives way to a notice naming the owner",
    notice.includes("The Octocat") &&
      (await teammate.page.getByTestId("composer-input").count()) === 0,
    notice
  );
  const before = await bodyLength(teammate.page);
  const working = await headerState(owner.page);

  await teammate.page.waitForTimeout(3000);
  check(
    rig,
    7,
    "the Teammate's streams close while the owner's turn still runs",
    (await bodyLength(teammate.page)) === before && working.startsWith("Working"),
    `owner: ${working}`
  );
  await shoot(rig, teammate, "s7-teammate-share-ended");
};

const queueDrop = (list: ReadonlyArray<string>) =>
  list.find((toast) => toast.includes("A queued turn didn't start")) ?? "";

export const stepRoleAndRevoke = async (rig: Rig) => {
  const { owner, teammate } = rig;

  await send(owner.page, bench({ items: 50, deltaIntervalMs: 400 }));
  await until(
    () => headerState(teammate.page),
    (state) => state.startsWith("Working")
  );
  await queue(teammate.page, "Also update the changelog");
  await owner.page.getByTestId("queued-turn").first().waitFor({ timeout: 10_000 });
  await shoot(rig, teammate, "s7-teammate-queued-as-contributor");

  // No Share changes role in place: the owner revokes, then shares again as a commenter.
  await owner.page.getByTestId("share-session").click();
  await owner.page.getByTestId("share-sheet").waitFor();
  await owner.page
    .getByTestId("share-person")
    .filter({ hasText: /hubot/i })
    .getByRole("button", { name: "Revoke" })
    .click();
  await checkCutOff(rig);
  await shoot(rig, owner, "s7-owner-revoked");

  await openShareSheet(owner.page, "Commenter");
  await submitShare(owner.page);
  await shoot(rig, owner, "s7-owner-shared-as-commenter");
  await owner.page.keyboard.press("Escape");
  const invite = await waitingInvite(teammate.page);

  await invite.getByRole("button", { name: "Open", exact: true }).click();

  const role = await until(
    () =>
      teammate.page
        .getByTestId("share-role")
        .innerText()
        .catch(() => ""),
    (text) => text === "Commenter",
    45_000
  );

  check(
    rig,
    7,
    "shared again as a commenter, the composer is gone at once",
    role === "Commenter" && (await teammate.page.getByTestId("composer-input").count()) === 0,
    role
  );

  const live = await until(
    () => sharedLine(teammate.page),
    (text) => /Commenter · (Working|Idle)/.test(text),
    60_000
  );

  check(
    rig,
    7,
    "the Teammate's session is live again as a commenter",
    /Commenter · (Working|Idle)/.test(live),
    live
  );
  await shoot(rig, teammate, "s7-teammate-commenter");

  // The turn queued as a contributor is refused as it would start, and the owner is told.
  const said = await until(
    () => toasts(owner.page),
    (list) => queueDrop(list) !== "",
    120_000
  );

  check(
    rig,
    7,
    "the turn queued before the downgrade is refused at its start, in words",
    queueDrop(said).includes("share ended"),
    queueDrop(said).replaceAll("\n", " ") || "no toast"
  );
  await shoot(rig, owner, "s7-owner-queued-turn-refused");
  const state = await untilIdle(owner.page, 30_000);

  check(
    rig,
    7,
    "nothing of the Teammate's ran: the session is idle with an empty queue",
    state.startsWith("Idle") && (await owner.page.getByTestId("queued-turn").count()) === 0,
    state
  );
};

export const stepHostOffline = async (rig: Rig) => {
  const { owner, teammate } = rig;

  await owner.daemon.stop();

  const gone = await until(
    () => sharedLine(teammate.page),
    (text) => text.includes("host offline"),
    60_000
  );

  check(
    rig,
    8,
    "the owner's Host going away reads host offline",
    gone.includes("host offline"),
    gone
  );
  await shoot(rig, teammate, "s8-teammate-host-offline");
  owner.daemon = await startPersonDaemon(owner.daemonHome);
  await owner.page
    .locator('[data-host="local"][data-connection="connected"]')
    .waitFor({ timeout: 60_000 });

  const back = await until(
    () => sharedLine(teammate.page),
    (text) => !text.includes("host offline") && text.includes("Commenter ·"),
    120_000
  );

  check(
    rig,
    8,
    "the Teammate recovers when the Host is back, without doing anything",
    !back.includes("host offline") && !back.includes("share ended"),
    back
  );
  await shoot(rig, teammate, "s8-teammate-recovered");
};

const sharedHostKey = (page: Page): Promise<string> =>
  page.evaluate(`new Promise((resolve) => {
    const off = window.polaris.subscribe("hosts", {}, { items: (items) => {
      const shared = items.at(-1)?.find((host) => host.shared);
      if (shared) { resolve(shared.key); setTimeout(off, 0); }
    } });
  })`);

/** Each thing a Teammate might try through the bridge, as the renderer would write the request. */
const attempts = (hostKey: string, repo: string, shared: string, other: string) => {
  const q = (value: Json) => JSON.stringify(value);

  const dispatch = (command: string) => [
    "dispatch",
    `{ hostKey: ${q(hostKey)}, commandId: crypto.randomUUID(), command: ${command} }`,
  ];

  const turn = (sessionId: string) =>
    dispatch(`{ _tag: "SendTurn", sessionId: ${q(sessionId)}, prompt: "hello", attachments: [] }`);

  return {
    "open a terminal": ["terminal.open", q({ hostKey, cwd: repo, cols: 80, rows: 24, argv: null })],
    "write a file": [
      "files.write",
      q({
        hostKey,
        path: `${repo}/README.md`,
        text: "x",
        expected: { mtimeMs: 0, size: 0, hash: "" },
      }),
    ],
    "create a file": ["files.create", q({ hostKey, path: `${repo}/x.txt`, kind: "file" })],
    "list the session's Shares": ["sharing.list", q({ hostKey, sessionId: shared })],
    "revoke a Share": [
      "sharing.revoke",
      q({ hostKey, shareId: "00000000-0000-4000-8000-000000000000" }),
    ],
    "send a turn into the owner's other session": turn(other),
    "rename the owner's other session": dispatch(
      `{ _tag: "RenameSession", sessionId: ${q(other)}, title: "mine now" }`
    ),
    "send a turn as a commenter": turn(shared),
  };
};

const REFUSALS = new Set(["NotShared", "NotGranted"]);

export const stepBoundaries = async (rig: Rig) => {
  const page = rig.teammate.page;
  const hostKey = await sharedHostKey(page);
  const [shared = "", other = ""] = rig.sessions;

  for (const [what, [method = "", input = ""]] of Object.entries(
    attempts(hostKey, rig.repo, shared, other)
  )) {
    const answer = await askSource(page, method, input);
    const code = answer.error?.code ?? "";

    check(
      rig,
      9,
      `the Host refuses a Teammate who tries to ${what}`,
      !answer.ok && REFUSALS.has(code),
      answer.ok ? "it went through" : `${code}: ${answer.error?.message.split("\n")[0]}`
    );
  }

  check(
    rig,
    9,
    "the Teammate's app offers no Share button",
    (await page.getByTestId("share-session").count()) === 0
  );
  await page.keyboard.press("Control+`");
  await page.waitForTimeout(800);
  const body = await page.locator("body").innerText();

  check(rig, 9, "the terminal shortcut opens no terminal there", !body.includes("Terminal"));
  check(
    rig,
    9,
    "the owner's other session is nowhere in the Teammate's app",
    !body.includes("Private notes")
  );
  await page.keyboard.press("Meta+k");
  await page.keyboard.insertText("Private");
  await page.waitForTimeout(800);
  check(
    rig,
    9,
    "Jump doesn't find the owner's other session",
    (await page.getByTestId("jump-item").filter({ hasText: "Private notes" }).count()) === 0
  );
  await shoot(rig, rig.teammate, "s9-teammate-jump");
  await page.keyboard.press("Escape");
  await shoot(rig, rig.teammate, "s9-teammate-session");
};
