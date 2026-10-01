/**
 * The smoke test's second, "remote" Host: a stand-in `ssh` on PATH runs every
 * command for alias `fake-studio` in a local `sh` with HOME at a temporary
 * directory, and the Daemon build the app uploads is a shell stand-in that
 * installs itself there and runs a real Daemon from source. The flow adds the
 * Host, approves the install and waits for it to connect.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import type { Page } from "playwright-core";
import {
  fakeSshScript,
  hostPlatform,
  writeDist,
} from "../../src/main/machines/fakeHost.testing.ts";
import type { MachineView, PolarisApi } from "../../src/shared/api.ts";
import { REPO_ROOT } from "./electron.ts";

export const FAKE_ALIAS = "fake-studio";

const decodeVersion = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
);

/** The renderer's global, for the functions `page.evaluate` runs there (no DOM lib here). */
declare const window: { readonly polaris: PolarisApi };

export interface FakeHost {
  /** Environment for the app: PATH with the stand-in ssh, the builds, the ssh config's home. */
  readonly env: Record<string, string>;
  readonly home: string;
  readonly sha256: string;
  /** Stops the Daemon the stand-in started, if any. */
  readonly stop: () => void;
}

export const prepareFakeHost = (root: string): FakeHost => {
  const home = join(root, "h");
  const bin = join(root, "bin");
  const dist = join(root, "dist");
  const sshHome = join(root, "me");

  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(sshHome, ".ssh"), { recursive: true });
  writeFileSync(join(bin, "ssh"), fakeSshScript(FAKE_ALIAS, home));
  chmodSync(join(bin, "ssh"), 0o755);
  writeFileSync(
    join(sshHome, ".ssh", "config"),
    [
      `Host ${FAKE_ALIAS}`,
      "  HostName studio.test",
      "  User lucas",
      "Host work-vm pi",
      "  HostName 10.0.4.12",
      "  User ubuntu",
      "Host *.internal",
      "  User ops",
      "",
    ].join("\n")
  );

  // The Daemon it runs is this repo's, so the build says the same version (no upgrade loop).
  const { version } = decodeVersion(
    readFileSync(join(REPO_ROOT, "apps/daemon/package.json"), "utf8")
  );

  const sha256 = writeDist(dist, {
    version,
    platform: hostPlatform(),
    daemon: ["bun", join(REPO_ROOT, "apps/daemon/src/main.ts")],
  });

  const pidFile = join(home, ".polaris", "stand-in.pid");

  return {
    home,
    sha256,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      POLARIS_DESKTOP_DAEMON_DIST: dist,
      POLARIS_DESKTOP_SSH_HOME: sshHome,
    },
    stop: () => {
      if (!existsSync(pidFile)) return;

      try {
        process.kill(Number(readFileSync(pidFile, "utf8").trim()), "SIGTERM");
      } catch {
        // Already gone.
      }
    },
  };
};

type Wanted = { readonly step?: string; readonly state?: string; readonly updateVersion?: string };

/** Resolves with the machine once its install step and Connection State are as wanted. */
const waitForMachine = (page: Page, wanted: Wanted, timeout: number) =>
  page.evaluate(
    ({ alias, wanted, timeout }) =>
      new Promise<MachineView>((resolve, reject) => {
        let last: MachineView | undefined;

        const matches = (m: MachineView) =>
          (wanted.step === undefined || m.install?.step === wanted.step) &&
          (wanted.state === undefined || m.status?.state === wanted.state) &&
          (wanted.updateVersion === undefined ||
            (m.daemon?.progress?.stage === "done" &&
              m.daemon.lastUpdate?.version === wanted.updateVersion));

        const stop = window.polaris.subscribe(
          "machines",
          {},
          {
            items: (lists) => {
              last = lists.at(-1)?.find((m) => m.key === alias);

              if (last === undefined || !matches(last)) return;
              clearTimeout(timer);
              stop();
              resolve(last);
            },
          }
        );

        const timer = setTimeout(() => {
          stop();
          reject(new Error(`waited for ${JSON.stringify(wanted)}; last ${JSON.stringify(last)}`));
        }, timeout);
      }),
    { alias: FAKE_ALIAS, wanted, timeout }
  );

const listAliases = (page: Page) =>
  page.evaluate(() => window.polaris.request("machines.sshAliases", {}));

const addFake = (page: Page) =>
  page.evaluate(
    (alias) =>
      window.polaris.request("machines.add", {
        alias,
        label: "Fake Studio",
        colour: null,
        forwardAgent: false,
      }),
    FAKE_ALIAS
  );

const approve = (page: Page, sha256: string) =>
  page.evaluate(
    (call) =>
      window.polaris.request("machines.approve", { hostKey: call.alias, sha256: call.sha256 }),
    { alias: FAKE_ALIAS, sha256 }
  );

export interface MachineFlowInput {
  readonly page: Page;
  readonly host: FakeHost;
  readonly step: (message: string) => void;
  /** Shows Settings → Hosts, when this build mounts it; the flow then drives the page. */
  readonly openHosts: (() => Promise<boolean>) | null;
  readonly shoot: (name: string) => Promise<void>;
}

const addThroughPage = async ({ page, host, step, shoot }: MachineFlowInput) => {
  await page.getByRole("button", { name: "Add a host" }).click();
  await page.getByRole("radio", { name: new RegExp(FAKE_ALIAS) }).click();
  await shoot("add-host");
  await page.getByTestId("add-machine").getByRole("button", { name: "Add host" }).click();
  await page.getByTestId("install-approval").waitFor({ timeout: 30_000 });
  const shown = await page.getByTestId("install-approval").innerText();

  if (!shown.includes(host.sha256.slice(0, 8)))
    throw new Error("the approval card lacks the SHA-256");
  step("approval card shows the build's SHA-256");
  await shoot("approve-install");
  await page.getByRole("button", { name: "Approve and install" }).click();
};

const addThroughRequests = async ({ page, host, step }: MachineFlowInput) => {
  await addFake(page);
  const asked = await waitForMachine(page, { step: "approval" }, 30_000);

  if (asked.install?.offer?.sha256 !== host.sha256) throw new Error("offered the wrong build");
  step("approval asked for the build's SHA-256");
  await approve(page, host.sha256);
};

export const machineFlow = async (input: MachineFlowInput) => {
  const { page, host, step, openHosts, shoot } = input;
  const listed = await listAliases(page);
  const aliases = { value: listed.ok ? listed.value : [] };

  if (!aliases.value.some((a) => a.alias === FAKE_ALIAS)) throw new Error("alias not listed");

  if (aliases.value.some((a) => a.alias.includes("*"))) throw new Error("listed a wildcard");
  step(`ssh config lists ${aliases.value.map((a) => a.alias).join(", ")}`);

  const onPage = openHosts !== null && (await openHosts());

  await (onPage ? addThroughPage(input) : addThroughRequests(input));
  const connected = await waitForMachine(page, { step: "ready", state: "connected" }, 60_000);

  if (!existsSync(join(host.home, ".polaris", "bin", "current", "polaris")))
    throw new Error("nothing was installed on the fake Host");
  step(
    `fake remote Host installed and connected (daemon ${connected.status?.host?.daemonVersion})`
  );

  if (onPage) await shoot("hosts");
  await updateFlow(input);
};

const updateFlow = async ({ page, host, step }: MachineFlowInput) => {
  const off = await page.evaluate(() =>
    window.polaris.request("machines.setKeepDaemonsUpToDate", { enabled: false })
  );

  if (!off.ok) throw new Error(off.error.message);

  const override = await page.evaluate(
    (hostKey) =>
      window.polaris.request("machines.setDaemonUpdateOverride", { hostKey, enabled: false }),
    FAKE_ALIAS
  );

  if (!override.ok) throw new Error(override.error.message);

  const version = "0.0.0-dev.900.abc1234";
  writeDist(host.env.POLARIS_DESKTOP_DAEMON_DIST!, {
    version,
    platform: hostPlatform(),
    daemon: ["bun", join(REPO_ROOT, "apps/daemon/src/main.ts")],
    paddingBytes: 400_000,
  });

  const requested = await page.evaluate(
    (hostKey) => window.polaris.request("machines.updateDaemon", { hostKey }),
    FAKE_ALIAS
  );

  if (!requested.ok) throw new Error(requested.error.message);

  const updated = await waitForMachine(page, { updateVersion: version }, 60_000);
  const facts = updated.daemon;

  if (facts?.lastUpdate?.result !== "updated" || facts.lastUpdate.from === null)
    throw new Error(`missing update result: ${JSON.stringify(facts)}`);

  if (facts.keepUpToDate || facts.keepDaemonsUpToDate || facts.keepUpToDateOverride !== false)
    throw new Error("explicit Update ignored the settings contract");

  if (facts.progress?.bytes !== facts.progress?.total || (facts.progress?.total ?? 0) < 400_000)
    throw new Error("upload progress did not report the real build size");
  step(
    `fake Host Update: ${facts.lastUpdate.from} → ${facts.lastUpdate.version}, ${facts.progress?.bytes} bytes; automatic updates off`
  );
};
