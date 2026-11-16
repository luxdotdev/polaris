import "../../../../test/dom.testing.ts";
import { afterEach, describe, expect, test } from "bun:test";
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  PersonId,
  ShareId,
  TurnId,
} from "@polaris/protocol";
import { TooltipProvider } from "@polaris/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { AppProvider } from "../../../../shell/hooks.ts";
import { seq, session, sessionId, turnWith } from "../../../../store/fixtures.testing.ts";
import type { SessionModel } from "../../../../store/sessionModel.ts";
import { type AppState, initialState, sessionKey } from "../../../../store/store.ts";
import { SendComments } from "./send.tsx";
import { MessageComments, QuotedComments, TurnAuthor } from "./transcript.tsx";

afterEach(cleanup);

const HOST = "h1";

const OWNER = Actor.cases.Client.make({});

const teammate = (name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${name}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const ana = teammate("Ana");

const bob = teammate("Bob");

const first = TurnId.make("t1");

const second = TurnId.make("t2");

const onMessage = (id: string, author: Actor, sent: TurnId | null) =>
  new Comment({
    id: CommentId.make(id),
    sessionId,
    anchor: CommentAnchor.cases.MessageText.make({
      turnId: first,
      messageId: "m1",
      start: 0,
      end: 9,
      quote: "flip them",
    }),
    body: `${id} body`,
    author,
    createdAt: "2026-11-16T10:00:00.000Z",
    sentInTurnId: sent,
  });

const onLines = (id: string, author: Actor) =>
  new Comment({
    id: CommentId.make(id),
    sessionId,
    anchor: CommentAnchor.cases.DiffLines.make({
      turnId: first,
      path: "src/parse.ts",
      side: "new",
      start: 3,
      end: 5,
      code: "const x = 1;",
    }),
    body: `${id} body`,
    author,
    createdAt: "2026-11-16T10:00:00.000Z",
    sentInTurnId: second,
  });

const model = (
  turnActors: ReadonlyArray<Actor | null>,
  comments: ReadonlyArray<Comment>
): SessionModel => ({
  sequence: seq(1),
  synchronized: true,
  session,
  turns: turnActors.map((actor, index) => ({
    turn: turnWith({ id: TurnId.make(`t${index + 1}`), index, actor, userTurnNumber: index + 1 }),
    items: [],
    live: new Map(),
    subagents: [],
  })),
  pendingApprovals: [],
  comments,
});

const mount = (shown: SessionModel, children: ReactNode) => {
  const store = createStore<AppState>(() => ({
    ...initialState,
    sessions: { [sessionKey(HOST, sessionId)]: shown },
  }));

  return render(
    <AppProvider
      value={{
        connection: {
          store,
          openSession: () => () => undefined,
          setDensity: () => undefined,
          setAppearance: () => undefined,
        },
        navigation: createNavigation({ app: store, storage: null }),
        commands: createCommandRegistry({ platform: "mac" }),
      }}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </AppProvider>
  );
};

const where = { hostKey: HOST, sessionId };

describe("Comments in the transcript", () => {
  test("a Turn that sent mixed authors' Comments quotes each with its author and anchor", () => {
    mount(
      model([OWNER, bob], [onMessage("c-ana", ana, second), onLines("c-owner", OWNER)]),
      <>
        <TurnAuthor {...where} actor={bob} />
        <QuotedComments {...where} ids={["c-ana", "c-owner"]} />
      </>
    );

    expect(screen.getByTestId("turn-author").textContent).toContain("Bob");
    const cards = screen.getByTestId("quoted-comments").children;

    expect([...cards].map((c) => c.textContent)).toEqual([
      "AAnaon Claude Code's messagec-ana body",
      "YYouon parse.ts:3–5c-owner body",
    ]);
  });

  test("a message's Comments fold to one line with their count, quote and Turn", () => {
    mount(
      model([OWNER, bob], [onMessage("c1", ana, second), onMessage("c2", bob, second)]),
      <MessageComments {...where} messageId="m1" />
    );

    const fold = screen.getByRole("button", { expanded: false });

    expect(fold.textContent).toBe("2 commentson “flip them”Sent with turn 2");
    fireEvent.click(fold);
    expect(screen.getAllByTestId("session-comment").map((c) => c.dataset.commentId)).toEqual([
      "c1",
      "c2",
    ]);
    expect(screen.getByLabelText("Reply")).not.toBeNull();
  });

  test("a session never shared shows no author slot and offers no sending", () => {
    mount(
      model([OWNER, null], []),
      <>
        <TurnAuthor {...where} actor={OWNER} />
        <SendComments {...where} />
      </>
    );

    expect(screen.queryByTestId("turn-author")).toBeNull();
    expect(screen.queryByTestId("send-comments")).toBeNull();
  });

  test("a Teammate's unsent Comment offers sending it as a Turn", () => {
    mount(model([OWNER], [onMessage("c1", ana, null)]), <SendComments {...where} />);

    expect(screen.getByTestId("send-comments").textContent).toContain("1 comment not sent");
  });
});
