import { describe, expect, test } from "bun:test";
import { normalizeHost, parseGitHubRemote, parsePullUrl, repoKey } from "./github.ts";

describe("parseGitHubRemote", () => {
  test.each([
    ["git@github.com:acme/widgets.git", "acme", "widgets"],
    ["git@github.com:acme/widgets", "acme", "widgets"],
    ["ssh://git@github.com/acme/widgets.git", "acme", "widgets"],
    ["ssh://git@github.com:22/acme/widgets", "acme", "widgets"],
    ["https://github.com/acme/widgets.git", "acme", "widgets"],
    ["https://lucas@github.com/acme/widgets/", "acme", "widgets"],
    ["git://github.com/acme/dot.files.git", "acme", "dot.files"],
  ])("%s", (url, owner, name) => {
    expect(parseGitHubRemote(url)).toEqual({ owner, name });
  });

  test("other hosts are not GitHub", () => {
    expect(parseGitHubRemote("git@gitlab.com:acme/widgets.git")).toBeNull();
    expect(parseGitHubRemote("https://github.example.com/acme/widgets")).toBeNull();
    expect(parseGitHubRemote("/Users/me/repos/widgets")).toBeNull();
  });
});

describe("parsePullUrl", () => {
  test("a pull request page, its files tab or a comment link", () => {
    for (const url of [
      "https://github.com/acme/widgets/pull/42",
      "https://github.com/acme/widgets/pull/42/files",
      "https://github.com/acme/widgets/pull/42#discussion_r1",
    ]) {
      expect(parsePullUrl(url)).toEqual({ repo: { owner: "acme", name: "widgets" }, number: 42 });
    }
  });

  test("anything else is refused", () => {
    expect(parsePullUrl("https://github.com/acme/widgets/issues/42")).toBeNull();
    expect(parsePullUrl("http://github.com/acme/widgets/pull/42")).toBeNull();
  });
});

describe("GitHub Enterprise hosts", () => {
  test("remotes on an added host carry it; unknown hosts are ignored", () => {
    const hosts = ["github.acme.com"];

    expect(parseGitHubRemote("git@github.acme.com:platform/api.git", hosts)).toEqual({
      host: "github.acme.com",
      owner: "platform",
      name: "api",
    });
    expect(parseGitHubRemote("ssh://git@github.acme.com:7999/platform/api", hosts)).toMatchObject({
      host: "github.acme.com",
    });
    expect(parseGitHubRemote("https://github.acme.com/platform/api.git", hosts)).toMatchObject({
      host: "github.acme.com",
    });
    expect(parseGitHubRemote("git@github.acme.com:platform/api.git")).toBeNull();
    expect(parseGitHubRemote("git@github.com:acme/widgets.git", hosts)).toEqual({
      owner: "acme",
      name: "widgets",
    });
  });

  test("a pull request URL on any host", () => {
    expect(parsePullUrl("https://github.acme.com/platform/api/pull/12/files")).toEqual({
      repo: { host: "github.acme.com", owner: "platform", name: "api" },
      number: 12,
    });
  });

  test("normalizeHost takes a host, its URL or its API URL", () => {
    expect(normalizeHost("GitHub.Acme.com")).toBe("github.acme.com");
    expect(normalizeHost("https://github.acme.com/api/v3/")).toBe("github.acme.com");
    expect(normalizeHost("acme.ghe.com")).toBe("acme.ghe.com");
    expect(normalizeHost("github.com")).toBeNull();
    expect(normalizeHost("api.github.com")).toBeNull();
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("a b.com")).toBeNull();
  });

  test("repoKey keeps the same name on two hosts apart", () => {
    expect(repoKey({ owner: "acme", name: "widgets" })).toBe("acme/widgets");
    expect(repoKey({ host: "github.acme.com", owner: "Acme", name: "Widgets" })).toBe(
      "github.acme.com/acme/widgets"
    );
  });
});
