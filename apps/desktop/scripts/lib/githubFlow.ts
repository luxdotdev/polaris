/**
 * The GitHub client in the smoke test, against the fake served on 127.0.0.1 (no
 * real network, no real account): sign in with the device flow, watch a Workspace's
 * remote (the smoke repo's own, watched by the renderer), see the pull request list, review
 * one, and see a merge reach its checkout.
 */
import type { Page } from "playwright-core";
import type { RequestInput, RequestMethod, RequestOutput } from "../../src/shared/api.ts";
import {
  createGitHubEnterpriseFake,
  createGitHubFake,
  FAKE_GHE_CLIENT_ID,
  type GitHubFake,
} from "./githubFake/index.ts";

export interface ServedFake {
  readonly fake: GitHubFake;
  /** For the app's environment: the client talks to the fake instead of github.com. */
  readonly env: Readonly<Record<string, string>>;
  readonly close: () => Promise<void>;
}

/** Device-flow polls every second instead of five, so the smoke doesn't wait. */
export const serveGitHubFake = async (): Promise<ServedFake> => {
  const fake = createGitHubFake({ interval: 1, enforceInterval: false });
  const served = await fake.serve();

  return {
    fake,
    env: { POLARIS_GITHUB_WEB_URL: served.url, POLARIS_GITHUB_API_URL: served.url },
    close: served.close,
  };
};

/** Chromium's flag: `safeStorage` uses an in-memory key, so no keychain prompt can stall a run. */
export const MOCK_KEYCHAIN = "--use-mock-keychain";

interface GitHubFlowInput {
  readonly page: Page;
  readonly fake: GitHubFake;
  readonly step: (message: string) => void;
  /** Runs once the PR list is in, before #42 is reviewed and merged. */
  readonly afterList: () => Promise<void>;
}

const request = <M extends RequestMethod>(page: Page, method: M, input: RequestInput<M>) =>
  page.evaluate<
    RequestOutput<M>
  >(`window.polaris.request(${JSON.stringify(method)}, ${JSON.stringify(input)}).then((r) => {
    if (!r.ok) throw new Error(r.error.code + ": " + r.error.message);
    return r.value;
  })`);

/** The first item of feed `kind` for which `holds` (a JS expression over `v`) is true. */
const feedUntil = <A>(page: Page, kind: string, holds: string, timeoutMs = 15_000) =>
  page.evaluate<A>(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(${JSON.stringify(`${kind}: never saw ${holds}`)})); }, ${timeoutMs});
    const off = window.polaris.subscribe(${JSON.stringify(kind)}, {}, {
      items: (items) => {
        const v = items.findLast((v) => ${holds});
        if (v !== undefined) { clearTimeout(timer); off(); resolve(v); }
      },
    });
  })`);

const PR = { repo: { owner: "acme", name: "widgets" }, number: 42 };

export const githubFlow = async ({ page, fake, step, afterList }: GitHubFlowInput) => {
  const started = await request(page, "github.signIn.start", {});

  fake.approveDevice(started.userCode, "mona");
  await feedUntil(
    page,
    "github.accounts",
    'v.signIn === null && v.accounts.some((a) => a.login === "mona")'
  );
  step(`GitHub: signed in as mona with code ${started.userCode}; tokens sealed by safeStorage`);

  await feedUntil(
    page,
    "github.pulls",
    'v.requested.some((p) => p.number === 42) && v.repos.some((r) => r.state === "blocked")'
  );
  step("GitHub: PR list has acme/widgets#42 under review requested; lockedorg/vault is blocked");

  const commented = () =>
    fake.world.reviews.filter((r) => r.author === "mona" && r.state === "COMMENTED").length;

  await afterList();

  // The Review UI's own submits (findingsFlow) are counted before this one.
  const before = commented();
  const detail = await request(page, "github.pull.detail", { pull: PR });

  await request(page, "github.files.setViewed", {
    pull: PR,
    pullId: detail.id,
    path: "src/webhooks/deliver.ts",
    viewed: true,
  });
  await request(page, "github.review.addThread", {
    pull: PR,
    pullId: detail.id,
    commitOid: null,
    path: "src/webhooks/deliver.ts",
    body: "Cap the attempts.",
    subjectType: "line",
    line: 30,
    side: "right",
    startLine: null,
    startSide: null,
  });
  await request(page, "github.review.submit", {
    pull: PR,
    pullId: detail.id,
    event: "comment",
    body: "From the smoke.",
  });

  const submitted = commented() - before;

  if (submitted !== 1)
    throw new Error(`expected one more submitted review, the fake has ${submitted}`);
  step(
    `GitHub: reviewed #42 (${detail.files.length} files, ${detail.threads.length} threads): Viewed, a line comment, submitted`
  );

  // The renderer's checkout publisher watches #42's Review Checkout (opened by the Review steps).
  await feedUntil(
    page,
    "github.checkouts",
    `v.some((c) => c.pullId === ${JSON.stringify(detail.id)} && c.state === "open")`
  );
  fake.merge("acme/widgets", 42);
  await request(page, "github.refresh", {});
  await feedUntil(
    page,
    "github.checkouts",
    `v.some((c) => c.pullId === ${JSON.stringify(detail.id)} && c.state === "merged")`
  );
  step("GitHub: merging #42 on GitHub reached its Review Checkout's state");
};

const GHE_HOST = "ghe.acme.test";

/** A GitHub Enterprise Server fake on 127.0.0.1, which the app reaches as `https://ghe.acme.test`. */
export const serveGitHubEnterpriseFake = async (): Promise<ServedFake> => {
  const fake = createGitHubEnterpriseFake({ interval: 1, enforceInterval: false });
  const served = await fake.serve();

  return {
    fake,
    env: { POLARIS_GITHUB_HOST_URLS: JSON.stringify({ [GHE_HOST]: served.url }) },
    close: served.close,
  };
};

interface EnterpriseFlowInput {
  readonly page: Page;
  readonly fake: GitHubFake;
  readonly step: (message: string) => void;
  /** Saves a screenshot of the window under `name`, when the run keeps them. */
  readonly shoot: (name: string) => Promise<void>;
}

const PR12 = { repo: { host: GHE_HOST, owner: "platform", name: "api" }, number: 12 };

/** Settings: add the GHE server and sign in to it; then its pull request is listed and reviewed. */
export const githubEnterpriseFlow = async ({ page, fake, step, shoot }: EnterpriseFlowInput) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "GitHub accounts", exact: true })
    .click();
  await page.getByRole("button", { name: "Add a GitHub Enterprise server" }).click();
  await page.getByLabel("Server", { exact: true }).fill(`https://${GHE_HOST}/api/v3`);
  await page.getByLabel("Client ID", { exact: true }).fill(FAKE_GHE_CLIENT_ID);
  await page.getByRole("button", { name: "Add server" }).click();
  await page
    .getByTestId("github-server")
    .filter({ hasText: GHE_HOST })
    .waitFor({ timeout: 10_000 });
  await shoot("github-enterprise-server");
  step(`GitHub Enterprise: added ${GHE_HOST} from its API URL in Settings`);

  await page.getByTestId("github-server").getByRole("button", { name: "Add account" }).click();
  await page
    .getByTestId("github-sign-in")
    .filter({ hasText: `Sign in on ${GHE_HOST}` })
    .waitFor({ timeout: 10_000 });

  const code = (await page.getByTestId("github-user-code").textContent()) ?? "";

  await shoot("github-enterprise-sign-in");
  fake.approveDevice(code.trim(), "mona-ent");
  await page
    .getByTestId("github-account")
    .filter({ hasText: "mona-ent" })
    .filter({ hasText: GHE_HOST })
    .waitFor({ timeout: 15_000 });
  await shoot("github-enterprise-accounts");
  step(
    `GitHub Enterprise: signed in as mona-ent on ${GHE_HOST} with code ${code.trim()} (device flow at /login/device)`
  );
  await page.keyboard.press("Escape");

  await feedUntil(
    page,
    "github.pulls",
    `v.requested.some((p) => p.host === "${GHE_HOST}" && p.number === 12)`
  );

  const detail = await request(page, "github.pull.detail", { pull: PR12 });

  await request(page, "github.review.submit", {
    pull: PR12,
    pullId: detail.id,
    event: "approve",
    body: "",
  });

  const approved = fake.world.reviews.filter(
    (r) => r.author === "mona-ent" && r.state === "APPROVED"
  ).length;

  const wrongPaths = fake.requests
    .filter((r) => r.kind !== "control" && r.status === 404)
    .map((r) => r.name);

  if (approved !== 1) throw new Error(`expected one approval on GHE, the fake has ${approved}`);

  if (wrongPaths.length > 0) throw new Error(`GHE got github.com paths: ${wrongPaths.join(", ")}`);
  step(`GitHub Enterprise: platform/api#12 listed and approved over /api/v3 and /api/graphql`);
};
