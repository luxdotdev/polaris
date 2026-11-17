/**
 * The shared scene (Paper SS1, ENG-941): a session two Teammates work in. Turn 25 is Maya's,
 * carrying Alex's message Comment and the owner's line Comment; the Changes lane holds threads
 * (one resolved, one outdated) and the owner's draft.
 */
import {
  Actor,
  Comment,
  CommentAnchor,
  CommentId,
  FeedbackBatch,
  PersonId,
  ShareId,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { openCommentDraft } from "../../comments/index.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { model, session, turn, view } from "./fixtures.ts";

const teammate = (name: string) =>
  Actor.cases.Teammate.make({
    shareId: ShareId.make(`share-${name}`),
    personId: PersonId.make(`person-${name}`),
    name,
  });

const alex = teammate("Alex Rivera");

const maya = teammate("Maya Chen");

const OWNER = Actor.cases.Client.make({});

/** The shared scene's session, which the sharing scenes share. */
export const SHARED_SESSION_ID = "s-shared";

const ID = SHARED_SESSION_ID;

// The fixture names a Turn by its index: turns 24 and 25 are indexes 23 and 24.
const T24 = TurnId.make(`${ID}-t23`);

const T25 = TurnId.make(`${ID}-t24`);

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const note = (
  id: string,
  author: Actor,
  anchor: CommentAnchor,
  body: string,
  marks: Partial<Pick<Comment, "sentInTurnId" | "resolvedAt" | "resolvedBy" | "outdatedInTurnId">>,
  age: number
) =>
  new Comment({
    id: CommentId.make(id),
    // SAFETY: the scene's session id, made from the same string.
    sessionId: session(ID, {}).id,
    anchor,
    body,
    author,
    createdAt: minutesAgo(age),
    ...marks,
  });

const onMessage = CommentAnchor.cases.MessageText.make({
  turnId: T24,
  messageId: "m24",
  start: 89,
  end: 118,
  quote: "flip between them with ← and →",
});

const onLine = (turnId: TurnId, path: string, line: number, code: string) =>
  CommentAnchor.cases.DiffLines.make({ turnId, path, side: "new", start: line, end: line, code });

const SERVE = "prototypes/orchestrator-layout/serve.ts";

const COMMENTS = [
  note(
    "c1",
    alex,
    onMessage,
    "Arrows already move between hunks. Use [ and ] instead?",
    { sentInTurnId: T25 },
    12
  ),
  note(
    "c2",
    OWNER,
    onLine(T24, SERVE, 4, "const API_TOKEN = process.env.API_TOKEN;"),
    "Read the token from the environment, never the file.",
    { sentInTurnId: T25 },
    10
  ),
  note("c3", maya, onMessage, "Agreed. I'll send both with the token fix.", {}, 9),
  note(
    "c4",
    alex,
    onLine(T25, SERVE, 4, "const API_TOKEN = process.env.API_TOKEN;"),
    "And rotate it; it's been in two pushes.",
    {},
    4
  ),
  note(
    "c5",
    maya,
    onLine(T25, SERVE, 4, "const API_TOKEN = process.env.API_TOKEN;"),
    "Rotated this morning.",
    { resolvedAt: minutesAgo(2), resolvedBy: maya },
    3
  ),
  note(
    "c6",
    alex,
    onLine(
      T25,
      "CONTEXT.md",
      141,
      "The view for launching, monitoring, and steering Agent Sessions."
    ),
    "Say Orchestrator, not view.",
    { outdatedInTurnId: T25 },
    6
  ),
];

export const shared = (): SessionModel => {
  const s = session(ID, { title: "Orchestrator layouts", turnCount: 25 });
  const I = TurnItem.cases;

  return model({
    session: s,
    comments: COMMENTS,
    turns: [
      view(
        turn(s.id, 23, "Prototype the Orchestrator layouts for 177.", "completed", [], {
          actor: OWNER,
        }),
        [
          I.AssistantMessage.make({
            id: "m24",
            text: "I'll build four structurally different variants from the same mock data, so you can flip between them with ← and →.",
          }),
        ]
      ),
      view(
        turn(s.id, 24, "", "working", [], {
          actor: maya,
          commentIds: [CommentId.make("c1"), CommentId.make("c2")],
          feedback: new FeedbackBatch({
            message: "Do both of these, then carry on with variant 4.",
            comments: [],
          }),
        }),
        [
          I.AssistantMessage.make({
            id: "m25",
            text: "Moving the keys to [ and ], and the token to the environment.",
          }),
        ]
      ),
    ],
  });
};

/** The owner's draft, on index.html's first new line. */
export const sharedDraft = (hostKey: string) =>
  openCommentDraft(hostKey, ID, {
    kind: "lines",
    turnId: T25,
    path: "prototypes/orchestrator-layout/index.html",
    side: "new",
    start: 412,
    end: 412,
    code: 'document.addEventListener("keydown", …',
  });
