import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CommitMessageStreamItem } from "@polaris/protocol";
import type { IpcError, PolarisApi, SubscriptionInput } from "../../../../../shared/api.ts";
import { standInBridge } from "../../../bridge.ts";
import type { Place } from "./actions.ts";
import { draftOf, setMessage } from "./draft.ts";
import { stopSuggesting, suggest, undoSuggestion } from "./suggest.ts";

const place: Place = { key: "h\u0000suggest", hostKey: "h", workspaceId: "w", root: "/w" };

const choice = { harness: "claude", model: "claude-haiku-5-5", effort: null };

type Input = SubscriptionInput<"commit.suggestMessage">;

interface Feed {
  readonly kind: string;
  readonly input: Input;
  readonly items: (items: ReadonlyArray<CommitMessageStreamItem>) => void;
  readonly end: (error: IpcError | null) => void;
  closed: boolean;
}

const feeds: Array<Feed> = [];

const last = (): Feed => {
  const feed = feeds.at(-1);

  if (feed === undefined) throw new Error("no feed opened");

  return feed;
};

const delta = (text: string) => CommitMessageStreamItem.cases.Delta.make({ text });

const suggested = (subject: string, body: string) =>
  CommitMessageStreamItem.cases.Suggested.make({
    message: { subject, body },
    truncated: false,
    thoughtMs: 10,
  });

beforeEach(() => {
  feeds.length = 0;
  setMessage(place.key, "");
  standInBridge({
    request: () => Promise.reject(new Error("no requests here")),
    // SAFETY: these tests open only `commit.suggestMessage`, whose items are CommitMessageStreamItem.
    subscribe: ((kind: string, input: Input, listener: Omit<Feed, "kind" | "input" | "closed">) => {
      const feed: Feed = { kind, input, ...listener, closed: false };

      feeds.push(feed);

      return () => {
        feed.closed = true;
      };
    }) as PolarisApi["subscribe"],
    onAppEvent: () => () => undefined,
  });
});

afterEach(() => {
  stopSuggesting(place.key);
  standInBridge(null);
});

describe("suggest", () => {
  test("asks the Host with the Settings choice for the Commit box's directory", () => {
    suggest(place, place.root, choice);

    expect(last().kind).toBe("commit.suggestMessage");
    expect(last().input).toEqual({
      hostKey: "h",
      cwd: "/w",
      harness: "claude",
      model: "claude-haiku-5-5",
      effort: null,
    });
    expect(draftOf(place.key).suggestion.kind).toBe("writing");
  });

  test("streams the subject in, then replaces the message with Undo", () => {
    setMessage(place.key, "wip");
    suggest(place, place.root, choice);
    last().items([delta('{"subject":"fix(hosts): stop')]);

    expect(draftOf(place.key).message).toBe("fix(hosts): stop");

    last().items([suggested("fix(hosts): stop retrying auth", "Asks once.")]);

    expect(draftOf(place.key).message).toBe("fix(hosts): stop retrying auth\n\nAsks once.");
    expect(draftOf(place.key).suggestion).toEqual({ kind: "replaced", before: "wip" });

    undoSuggestion(place.key);

    expect(draftOf(place.key).message).toBe("wip");
    expect(draftOf(place.key).suggestion.kind).toBe("idle");
  });

  test("typing over a written message drops Undo", () => {
    suggest(place, place.root, choice);
    last().items([suggested("chore: bump", "")]);
    setMessage(place.key, "chore: bump deps");

    expect(draftOf(place.key).suggestion.kind).toBe("idle");
  });

  test("Stop cancels the Harness and puts the message back", () => {
    setMessage(place.key, "mine");
    suggest(place, place.root, choice);
    last().items([delta('{"subject":"other')]);
    stopSuggesting(place.key);

    expect(last().closed).toBe(true);
    expect(draftOf(place.key).message).toBe("mine");
    expect(draftOf(place.key).suggestion.kind).toBe("idle");
  });

  test("a refusal keeps the message and says why", () => {
    setMessage(place.key, "mine");
    suggest(place, place.root, choice);
    last().end({ code: "needs-sign-in", message: "Sign in to Claude Code" });

    expect(draftOf(place.key).message).toBe("mine");
    expect(draftOf(place.key).suggestion).toEqual({
      kind: "failed",
      reason: "needs-sign-in",
      message: "Sign in to Claude Code",
    });
  });

  test("a second press while writing opens nothing new", () => {
    suggest(place, place.root, choice);
    suggest(place, place.root, choice);

    expect(feeds).toHaveLength(1);
  });
});
