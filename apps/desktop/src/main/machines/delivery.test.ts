import { expect, test } from "bun:test";
import { type DaemonBuild, Delivery, InstallPlan } from "@polaris/client/install";
import { deliveryActivity } from "./delivery.ts";

const build: DaemonBuild = {
  platform: "linux-arm64",
  version: "0.2.0",
  sha256: "abc",
  files: [],
  bundled: false,
  archive: null,
};

const copy = { host: "workbox", copying: "Copying the build over SSH", platform: "darwin" };

test("the install card says where the build comes from", () => {
  const install = (delivery: Delivery) =>
    deliveryActivity(InstallPlan.Install({ build, delivery }), copy);

  expect(install(Delivery.Upload())).toBe("Copying the build over SSH");
  expect(install(Delivery.HostFetch({ tool: "curl" }))).toBe(
    "Downloading the build on workbox and checking its SHA-256"
  );
  expect(install(Delivery.ClientFetch())).toBe(
    "Downloading the build to this Mac, then copying it to workbox"
  );
  expect(
    deliveryActivity(InstallPlan.Install({ build, delivery: Delivery.ClientFetch() }), {
      ...copy,
      platform: "win32",
    })
  ).toBe("Downloading the build to this PC, then copying it to workbox");
});

test("plans that copy nothing keep the copying line", () => {
  expect(deliveryActivity(InstallPlan.UpToDate({ version: "0.2.0" }), copy)).toBe(
    "Copying the build over SSH"
  );
});
