import { expect, test } from "bun:test";
import type { AccountRecord } from "@polaris/client/accounts";
import { POLARIS_CLOUD_ACCOUNTS_URL } from "@polaris/protocol";
import { accountRows } from "./model.ts";

const account = (overrides: Partial<AccountRecord>): AccountRecord => ({
  id: "a1",
  server: POLARIS_CLOUD_ACCOUNTS_URL,
  personId: "p1",
  login: "octocat",
  name: null,
  avatarUrl: null,
  commitEmail: "octocat@github.com",
  commitEmails: ["octocat@github.com"],
  signedInAt: 1,
  signedOutAt: null,
  ...overrides,
});

test("Polaris Cloud by name, a self-hosted server by its host", () => {
  const rows = accountRows([
    account({}),
    account({ id: "a2", server: "https://auth.acme.dev", login: "hubot" }),
  ]);

  expect(rows.map((row) => [row.login, row.server])).toEqual([
    ["octocat", "Polaris Cloud"],
    ["hubot", "auth.acme.dev"],
  ]);
});

test("a refused session reads Signed out instead of its commit email", () => {
  const [row] = accountRows([account({ signedOutAt: 5 })]);

  expect([row?.line, row?.signedOut]).toEqual(["Signed out", true]);
});

test("the commit email is a choice only when there's more than one verified address", () => {
  const rows = accountRows([
    account({}),
    account({ id: "a2", commitEmails: ["o@github.com", "o@work.dev"] }),
  ]);

  expect(rows.map((row) => row.emails.length)).toEqual([0, 2]);
});
