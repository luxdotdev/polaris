import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SignInView } from "../../../../shared/github.ts";
import { setClientPlatform } from "../../../../shared/platform.ts";
import { installFakeBridge, type FakeBridge } from "../../../test/bridge.testing.ts";
import { AddGitHubAccount } from "./AddGitHubAccount.tsx";

let fake: FakeBridge;

beforeEach(() => {
  fake = installFakeBridge();
  setClientPlatform("win32");
});

afterEach(() => {
  cleanup();
  setClientPlatform(null);
});

/** What main publishes when the device code request never reached GitHub. */
const unstarted = (extra: Partial<SignInView>): SignInView => ({
  flowId: "unstarted",
  host: "github.com",
  userCode: null,
  verificationUri: null,
  expiresAt: 0,
  state: "failed",
  failure: "network",
  detail: "net::ERR_PROXY_CONNECTION_FAILED",
  ...extra,
});

test("a device code request that couldn't reach GitHub says so, with what to check and Try again", () => {
  const card = within(render(<AddGitHubAccount flow={unstarted({})} />).container);
  const status = card.getByRole("status");

  expect(status.textContent).toContain("Couldn't reach GitHub");
  expect(status.textContent).toContain(
    "Polaris uses this PC's proxy settings. If a proxy or a security tool like Zscaler filters your network, check that it allows github.com."
  );
  expect(status.textContent).toContain("net::ERR_PROXY_CONNECTION_FAILED");
  expect(card.queryByTestId("github-user-code")).toBeNull();

  fireEvent.click(card.getByRole("button", { name: "Try again" }));
  expect(fake.sent("github.signIn.start")).toEqual([{ host: "github.com" }]);
});

test("an untrusted certificate names the certificate, and the server for Enterprise", () => {
  const card = within(
    render(
      <AddGitHubAccount
        flow={unstarted({
          host: "ghe.acme.test",
          failure: "certificate",
          detail: "net::ERR_CERT_AUTHORITY_INVALID",
        })}
      />
    ).container
  );

  const status = card.getByRole("status").textContent;

  expect(status).toContain("GitHub's certificate isn't trusted on this PC");
  expect(status).toContain("needs its root certificate installed on this PC");
  expect(status).toContain("net::ERR_CERT_AUTHORITY_INVALID");

  fireEvent.click(card.getByRole("button", { name: "Try again" }));
  expect(fake.sent("github.signIn.start")).toEqual([{ host: "ghe.acme.test" }]);
});

test("a dropped network while waiting keeps the code and offers a new one", () => {
  const card = within(
    render(
      <AddGitHubAccount
        flow={unstarted({
          flowId: "f",
          userCode: "WDJB-MJHT",
          verificationUri: "https://github.com/login/device",
          expiresAt: Date.now() + 600_000,
          detail: "net::ERR_INTERNET_DISCONNECTED",
        })}
      />
    ).container
  );

  expect(card.getByTestId("github-user-code").textContent).toBe("WDJB-MJHT");
  expect(card.getByText("Couldn't reach GitHub")).not.toBeNull();
  expect(card.getByRole("button", { name: "Get a new code" })).not.toBeNull();
});
