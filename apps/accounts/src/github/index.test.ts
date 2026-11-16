import { expect, test } from "bun:test";
import type { GitHubConfig } from "../config.ts";
import { Redacted } from "effect";
import { commitEmailChoices, defaultCommitEmail, noreplyEmail } from "./index.ts";

const github = (webUrl: string): GitHubConfig => ({
  clientId: "id",
  clientSecret: Redacted.make("secret"),
  webUrl,
  apiUrl: `${webUrl}/api`,
});

const person = { githubId: "583231", login: "octocat" };

test("noreply addresses follow the GitHub host, so Enterprise Server gets its own domain", () => {
  expect(noreplyEmail(github("https://github.com"), person)).toBe(
    "583231+octocat@users.noreply.github.com"
  );
  expect(noreplyEmail(github("https://git.corp.example"), person)).toBe(
    "583231+octocat@users.noreply.git.corp.example"
  );
});

test("commit addresses are the verified ones, primary first, then noreply; unverified never", () => {
  const emails = [
    { email: "b@example.com", primary: false, verified: true },
    { email: "x@example.com", primary: false, verified: false },
    { email: "a@example.com", primary: true, verified: true },
  ];

  expect(commitEmailChoices(github("https://github.com"), person, emails)).toEqual([
    "a@example.com",
    "b@example.com",
    "583231+octocat@users.noreply.github.com",
  ]);
  expect(defaultCommitEmail(github("https://github.com"), person, emails)).toBe("a@example.com");
});

test("an unverified primary falls back to noreply", () => {
  const emails = [{ email: "a@example.com", primary: true, verified: false }];
  expect(defaultCommitEmail(github("https://github.com"), person, emails)).toBe(
    "583231+octocat@users.noreply.github.com"
  );
});
