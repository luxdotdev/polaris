/**
 * Steps 1 to 5 of `sharingE2e.ts`: sharing as a Contributor, the Invite and presence, the shared
 * queue, approvals for both people, and Comments carried into a Turn.
 */
import type { Page } from "playwright-core";
import {
  bench,
  check,
  closeSettings,
  createSessions,
  headerState,
  openShareSheet,
  queue,
  request,
  type Rig,
  send,
  shoot,
  signIn,
  submitShare,
  toasts,
  until,
  untilIdle,
  waitingInvite,
} from "./sharingRig.ts";

/** A glossary term capitalised mid-sentence (rule/glossary-lowercase). */
const CAPITALISED =
  /[a-z,] (Turns?|Approvals?|Shares?|Hosts?|Sessions?|Commenters?|Contributors?)\b/;

const openSession = async (page: Page) => {
  await page.getByText("Fix the login redirect").first().click();
  await page.getByTestId("session-title").waitFor({ timeout: 10_000 });
};

export const stepShare = async (rig: Rig) => {
  const { owner, servers } = rig;
  const page = owner.page;

  await signIn(owner, servers.server);
  await shoot(rig, owner, "s1-owner-account");
  await closeSettings(page);
  // Before any Share: turning the relay route on would otherwise pick Polaris Cloud.
  await request(page, "relayRoute.setUrl", { hostKey: "local", url: servers.relay });
  rig.sessions = await createSessions(page, rig.repo);
  await openSession(page);
  await openShareSheet(page, "Contributor");
  const sheet = await page.getByTestId("share-sheet").innerText();

  check(
    rig,
    1,
    "the share sheet says what a contributor can do and whose plan pays",
    sheet.includes("@hubot will see everything in this session, including command output.") &&
      sheet.includes("@hubot's turns run on your Claude login and count against your plan."),
    sheet.replaceAll(/\n+/g, " ").slice(0, 420)
  );
  check(
    rig,
    1,
    "the share sheet warns about a personal Claude login",
    sheet.includes("If it's a personal subscription"),
    "the bench Harness reports no plan, so this is the unknown-login wording"
  );
  check(rig, 1, "share sheet copy keeps glossary terms lowercase", !CAPITALISED.test(sheet));
  await shoot(rig, owner, "s1-owner-share-sheet");
  await page.getByLabel("GitHub handle").fill("@nobody-here");
  await page.getByTestId("share-submit").click();
  await page.getByTestId("share-refusal").waitFor({ timeout: 15_000 });
  const refusal = await page.getByTestId("share-refusal").innerText();

  check(
    rig,
    1,
    "a login nobody signed in with is refused in words",
    refusal.includes("nobody-here"),
    refusal
  );
  await page.getByLabel("GitHub handle").fill("@hubot");
  await submitShare(page);

  const route = await request<{ url: string; connected: boolean }>(page, "relayRoute.status", {
    hostKey: "local",
  });

  check(
    rig,
    1,
    "the owner's Host is on the local relay only",
    route.url === servers.relay,
    route.url
  );
  await shoot(rig, owner, "s1-owner-shared");
  await page.keyboard.press("Escape");
};

export const stepOpen = async (rig: Rig) => {
  const { owner, teammate, servers } = rig;

  await signIn(teammate, servers.server);
  await closeSettings(teammate.page);
  const invite = await waitingInvite(teammate.page);
  const text = (await invite.innerText()).replaceAll(/\n+/g, " ");

  check(
    rig,
    2,
    "the Invite names the owner, the role and the commit email",
    text.includes("The Octocat shared Fix the login redirect with you") &&
      text.includes("Contributor") &&
      text.includes("hubot@acme.example"),
    text
  );
  await shoot(rig, teammate, "s2-teammate-invite");
  const started = Date.now();

  await invite.getByRole("button", { name: "Open", exact: true }).click();
  await teammate.page.getByTestId("share-role").waitFor({ timeout: 45_000 });
  await teammate.page.getByTestId("session-title").waitFor({ timeout: 45_000 });
  check(
    rig,
    2,
    "the Teammate opens the session over the relay",
    true,
    `${Date.now() - started} ms`
  );

  const sees = (page: Page, name: string) =>
    page
      .locator(`[aria-label="${name} has this session open"]`)
      .first()
      .waitFor({ timeout: 20_000 })
      .then(
        () => true,
        () => false
      );

  check(rig, 2, "the owner sees the Teammate present", await sees(owner.page, "Hubot"));
  check(rig, 2, "the Teammate sees the owner present", await sees(teammate.page, "The Octocat"));
  check(
    rig,
    2,
    "nobody is shown their own avatar",
    (await teammate.page.locator('[aria-label="Hubot has this session open"]').count()) === 0
  );
  check(
    rig,
    2,
    "the Teammate's rail doesn't call the owner's repository missing",
    !(await teammate.page.locator("body").innerText()).includes("Not a git repository")
  );
  await shoot(rig, owner, "s2-owner-presence");
  await shoot(rig, teammate, "s2-teammate-session");
};

const queuedAuthors = (page: Page) => page.getByTestId("queued-turn-author").allInnerTexts();

const queuedRow = (page: Page, prompt: string) =>
  page.getByTestId("queued-turn").filter({ hasText: prompt });

export const stepQueue = async (rig: Rig) => {
  const { owner, teammate } = rig;

  await send(owner.page, bench({ items: 80, deltaIntervalMs: 400 }));
  await until(
    () => headerState(teammate.page),
    (state) => state.startsWith("Working")
  );
  await queue(teammate.page, "Also cover the signed-out case");
  await queuedRow(owner.page, "Also cover").waitFor({ timeout: 10_000 });
  await queue(owner.page, "Then update the docs");
  await queuedRow(teammate.page, "Then update").waitFor({ timeout: 10_000 });

  const [mine, theirs] = [await queuedAuthors(owner.page), await queuedAuthors(teammate.page)];

  check(
    rig,
    3,
    "the owner's queue names Hubot, then You",
    mine.join() === "Hubot,You",
    mine.join()
  );
  check(
    rig,
    3,
    "the Teammate's queue names You, then the owner",
    theirs.join() === "You,The Octocat",
    theirs.join()
  );
  check(
    rig,
    3,
    "the Teammate can't edit or cancel the owner's queued turn",
    (await queuedRow(teammate.page, "Then update").getByRole("button").count()) === 0
  );
  await shoot(rig, owner, "s3-owner-queue");
  await shoot(rig, teammate, "s3-teammate-queue");

  await queuedRow(owner.page, "Also cover").getByRole("button", { name: "Edit" }).click();
  await owner.page.getByLabel("Queued turn").fill("Also cover the signed-out case, with a test");
  await owner.page.getByRole("button", { name: "Save" }).click();

  const edited = await queuedRow(teammate.page, "with a test")
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false
    );

  check(rig, 3, "the owner's edit of the Teammate's queued turn reaches the Teammate", edited);
  await queuedRow(owner.page, "Then update").getByTestId("queued-turn-cancel").click();

  const left = await until(
    () => queuedAuthors(teammate.page),
    (authors) => authors.length === 1
  );

  check(rig, 3, "the owner's cancel removes the turn for both", left.join() === "You", left.join());

  await owner.page.getByRole("button", { name: "Stop" }).first().click();
  await owner.page.getByTestId("queue-paused").waitFor({ timeout: 15_000 });
  const paused = await owner.page.getByTestId("queue-paused").innerText();

  check(
    rig,
    3,
    "Interrupt pauses the queue",
    paused.includes("Queue paused"),
    paused.replaceAll("\n", " ")
  );
  await shoot(rig, owner, "s3-owner-queue-paused");
  await shoot(rig, teammate, "s3-teammate-queue-paused");
  await owner.page.getByTestId("queue-resume").click();
  await until(
    () => owner.page.getByTestId("queued-turn").count(),
    (count) => count === 0
  );
  await untilIdle(owner.page);
  const authors = await owner.page.getByTestId("turn-author").allInnerTexts();

  check(
    rig,
    3,
    "Resume starts the queued turn as its sender's",
    (authors.at(-1) ?? "").includes("Hubot"),
    (authors.at(-1) ?? "").replaceAll("\n", " ")
  );
  await shoot(rig, owner, "s3-owner-resumed");
};

const approveButtons = (page: Page) => page.getByRole("button", { name: "Approve" });

const click = (page: Page, name: string) =>
  page
    .getByRole("button", { name, exact: true })
    .first()
    .click({ timeout: 5000 })
    .then(
      () => true,
      () => false
    );

export const stepApprovals = async (rig: Rig) => {
  const { owner, teammate } = rig;
  const ask = bench({ items: 1, approvalEvery: 1 });

  await send(owner.page, ask);
  await approveButtons(owner.page).first().waitFor({ timeout: 20_000 });
  await teammate.page.getByRole("radio", { name: /^Needs you/ }).click();

  const inbox = await until(
    () => teammate.page.locator("body").innerText(),
    (text) => text.includes("1 waiting")
  );

  check(rig, 4, "Needs You reaches the contributor's inbox", inbox.includes("1 waiting"));
  await shoot(rig, teammate, "s4-teammate-inbox");
  await teammate.page.getByRole("radio", { name: /^Sessions/ }).click();
  check(
    rig,
    4,
    "only the owner is offered Always here",
    (await teammate.page.getByRole("button", { name: "Always here" }).count()) === 0 &&
      (await owner.page.getByRole("button", { name: "Always here" }).count()) > 0
  );
  await shoot(rig, owner, "s4-owner-approval");
  await shoot(rig, teammate, "s4-teammate-approval");
  await approveButtons(teammate.page).first().click();
  const state = await untilIdle(owner.page, 30_000);

  check(
    rig,
    4,
    "the Teammate's answer clears the owner's card and the turn goes on",
    state.startsWith("Idle") && (await approveButtons(owner.page).count()) === 0,
    state
  );

  // Both answer the next one at once: one wins, the other is told so without a request id.
  await send(owner.page, ask);
  await approveButtons(owner.page).first().waitFor({ timeout: 20_000 });
  await approveButtons(teammate.page).first().waitFor({ timeout: 20_000 });
  await Promise.all([click(teammate.page, "Deny"), click(owner.page, "Approve")]);
  const after = await untilIdle(owner.page, 30_000);
  const said = [...(await toasts(owner.page)), ...(await toasts(teammate.page))];

  check(
    rig,
    4,
    "the first answer wins and the other side clears",
    after.startsWith("Idle") &&
      (await approveButtons(owner.page).count()) + (await approveButtons(teammate.page).count()) ===
        0,
    after
  );
  check(
    rig,
    4,
    "whoever lost the race is told in words, with no request id",
    said.every((toast) => !/request \S+ is already/.test(toast)),
    said.map((toast) => toast.replaceAll("\n", " ")).join(" / ") ||
      "no toast: one click landed after the card had cleared"
  );
  await shoot(rig, owner, "s4-owner-after-race");
  await shoot(rig, teammate, "s4-teammate-after-race");
};

/** Selects the start of the last message, as a person dragging across it does. */
const selectInLastMessage = async (page: Page) => {
  const message = page.locator("[data-comment-message]").last();

  await message.scrollIntoViewIfNeeded();
  // A string: the script's own types have no DOM.
  await page.evaluate(`(() => {
    const element = [...document.querySelectorAll("[data-comment-message]")].at(-1);
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(18, text.textContent.length));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  })()`);
};

const post = async (page: Page, text: string) => {
  await page.getByLabel("Comment", { exact: true }).fill(text);
  await page.getByTestId("comment-post").click();
};

export const stepComments = async (rig: Rig) => {
  const { owner, teammate } = rig;

  await send(owner.page, bench({ items: 3, touchFiles: 2 }));
  await until(
    () => headerState(owner.page),
    (state) => state.startsWith("Working"),
    5000
  );
  await untilIdle(owner.page);
  await teammate.page.waitForTimeout(1000);

  await selectInLastMessage(teammate.page);
  await teammate.page.getByTestId("selection-comment").click();
  await teammate.page
    .getByLabel("Comment", { exact: true })
    .fill("This reads the redirect too early.");
  await shoot(rig, teammate, "s5-teammate-message-draft");
  await teammate.page.getByTestId("comment-post").click();

  const line = teammate.page
    .locator('button[title="Comment on this line"]')
    .filter({ hasText: /^3$/ })
    .last();

  await line.scrollIntoViewIfNeeded();
  await line.click();
  await post(teammate.page, "Keep the old redirect for signed-out people.");
  await teammate.page.getByTestId("changes-comments").first().waitFor({ timeout: 10_000 });
  await shoot(rig, teammate, "s5-teammate-line-comment");

  await owner.page.getByTestId("changes-comments").first().waitFor({ timeout: 10_000 });
  await owner.page.getByTestId("message-comments").last().locator("button").first().click();
  const onMessage = await owner.page.getByTestId("message-comments").last().innerText();
  const onLine = await owner.page.getByTestId("changes-comments").first().innerText();

  check(
    rig,
    5,
    "the owner sees both of the Teammate's comments, by name",
    onMessage.includes("Hubot") && onLine.includes("Hubot") && onLine.includes("signed-out people")
  );
  await shoot(rig, owner, "s5-owner-comments");
  const unsent = await owner.page.getByTestId("send-comments").innerText();

  check(
    rig,
    5,
    "the composer counts the comments not sent",
    unsent.includes("2 comments not sent"),
    unsent.replaceAll("\n", " ")
  );
  await owner.page.getByTestId("send-comments-turn").click();
  await owner.page.getByTestId("quoted-comments").last().waitFor({ timeout: 15_000 });
  const card = await owner.page.getByTestId("quoted-comments").last().innerText();

  check(
    rig,
    5,
    "the turn's carried-comment card names the author and where each comment was",
    card.split("Hubot").length === 3 &&
      card.includes("on Claude Code's message") &&
      card.includes("file-1.txt:3"),
    card.replaceAll(/\n+/g, " ")
  );
  await owner.page.getByTestId("quoted-comments").last().scrollIntoViewIfNeeded();
  await shoot(rig, owner, "s5-owner-carried-comments");
  await teammate.page.getByTestId("quoted-comments").last().waitFor({ timeout: 15_000 });
  await teammate.page.getByTestId("quoted-comments").last().scrollIntoViewIfNeeded();
  await shoot(rig, teammate, "s5-teammate-carried-comments");
  await untilIdle(owner.page);
};
