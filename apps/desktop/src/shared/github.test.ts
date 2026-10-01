import { describe, expect, test } from "bun:test";
import { parseGitHubRemote, parsePullUrl } from "./github.ts";

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
