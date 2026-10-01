/**
 * The commit message and pull request text for accepted Turns (ENG-224). The
 * session's own Harness drafts them in a short Turn of a fresh native session,
 * kept out of the Agent Session: it gets the Turns' prompts and replies (as a
 * Fork does) and the diff's stat, and answers JSON. A template built from the
 * Turns stands in when it can't.
 */
import {
  AcceptDraft,
  ApprovalDecision,
  type AgentSession,
  SessionId,
  TurnId,
} from "@polaris/protocol";
import { Duration, Effect, Option, Predicate, Schema, Stream } from "effect";
import { type HarnessDriver, HarnessEvent } from "../harness/HarnessDriver.ts";
import { type ForkedTurn, forkPreamble } from "../engine/fork.ts";

/** Commit titles, at most. */
const TITLE_LIMIT = 72;

/** How long the Harness gets before the template is used. */
export const DRAFT_TIMEOUT = Duration.seconds(90);

const firstLine = (text: string): string => text.trim().split("\n")[0]?.trim() ?? "";

export const clipTitle = (text: string): string => {
  const line = firstLine(text).replace(/\.$/, "");

  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : line;
};

export interface DraftTurn {
  readonly index: number;
  readonly prompt: string;
  readonly reply: string | null;
}

export interface DraftInput {
  readonly session: Pick<AgentSession, "id" | "title" | "harness" | "model" | "effort">;
  readonly turns: ReadonlyArray<DraftTurn>;
  /** `git diff --stat` of the change. */
  readonly stat: string;
}

const turnLabel = (turns: ReadonlyArray<DraftTurn>): string => {
  const first = turns[0]?.index ?? 0;
  const last = turns.at(-1)?.index ?? first;

  return first === last ? `Turn ${first + 1}` : `Turns ${first + 1}–${last + 1}`;
};

/** The fallback: titles from the prompts, the body a list of the Turns. */
export const templateDraft = (input: DraftInput, note: string | null): AcceptDraft => {
  const turnTitles = input.turns.map((turn) => clipTitle(turn.prompt) || `Turn ${turn.index + 1}`);

  const title =
    input.turns.length === 1 ? (turnTitles[0] ?? "") : clipTitle(input.session.title) || "";

  const list = turnTitles.map((t) => `- ${t}`).join("\n");
  const body = input.turns.length > 1 ? list : "";

  const prBody = [
    list,
    "",
    `Accepted in Polaris from the agent session "${input.session.title}" (${turnLabel(input.turns)}).`,
  ].join("\n");

  return new AcceptDraft({
    title: title === "" ? turnLabel(input.turns) : title,
    body,
    prTitle: title === "" ? turnLabel(input.turns) : title,
    prBody,
    turnTitles,
    source: "template",
    note,
  });
};

export const draftPrompt = (input: DraftInput): string => {
  const turns: ReadonlyArray<ForkedTurn> = input.turns.map((t) => ({
    prompt: t.prompt,
    reply: t.reply,
  }));

  const ask = [
    `The user accepted the work of ${turnLabel(input.turns).toLowerCase()} and will commit it and open a pull request.`,
    "Write the commit message and the pull request text. Don't run tools or change files.",
    "",
    "The change:",
    "```",
    input.stat.trim(),
    "```",
    "",
    "Answer with only a JSON object, no fences:",
    `{"title": "...", "body": "...", "prTitle": "...", "prBody": "...", "turnTitles": ["...", ...]}`,
    `- title: imperative mood, at most ${TITLE_LIMIT} characters, no trailing period`,
    "- body: what changed and why, plain text wrapped at 72 columns; empty if the title says it all",
    "- prTitle: like title; prBody: Markdown for reviewers, a short summary and anything to check",
    `- turnTitles: ${input.turns.length} commit titles, one per turn in order, for committing each turn on its own`,
  ].join("\n");

  return forkPreamble({
    parentTitle: input.session.title,
    turns,
    ownWorktree: false,
    prompt: ask,
  });
};

const DraftJson = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  prTitle: Schema.String,
  prBody: Schema.String,
  turnTitles: Schema.Array(Schema.String),
});

/** The Harness's reply as a draft, or null when it isn't the JSON asked for. */
export const parseDraft = (text: string, turns: number): AcceptDraft | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end <= start) return null;

  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(DraftJson))(
    text.slice(start, end + 1)
  );

  if (Option.isNone(decoded) || clipTitle(decoded.value.title) === "") return null;
  const draft = decoded.value;
  const turnTitles = Array.from({ length: turns }, (_, i) => clipTitle(draft.turnTitles[i] ?? ""));

  return new AcceptDraft({
    title: clipTitle(draft.title),
    body: draft.body.trim(),
    prTitle: clipTitle(draft.prTitle) || clipTitle(draft.title),
    prBody: draft.prBody.trim(),
    turnTitles: turnTitles.map((t, i) => t || `Turn ${i + 1}`),
    source: "harness",
    note: null,
  });
};

const deny = ApprovalDecision.cases.Deny.make({
  reason: "Drafting a commit message runs no tools.",
});

/** Runs one Turn in a fresh native session and answers its last reply. */
const askHarness = (driver: HarnessDriver, cwd: string, input: DraftInput) =>
  Effect.scoped(
    Effect.gen(function* () {
      const draftId = SessionId.make(`${input.session.id}-accept-draft`);
      const turnId = TurnId.make(`${input.session.id}-accept-draft-turn`);

      const harness = yield* driver.open({
        sessionId: draftId,
        cwd,
        permissionMode: "supervised",
        model: input.session.model,
        effort: input.session.effort,
        resumeCursor: null,
      });

      yield* harness.sendTurn({
        turnId,
        prompt: draftPrompt(input),
        attachments: [],
        model: input.session.model,
        effort: input.session.effort,
      });
      let reply: string | null = null;
      yield* harness.events.pipe(
        Stream.tap((event) => {
          if (HarnessEvent.$is("ApprovalRequested")(event)) {
            return harness.respond(event.requestId, deny);
          }

          if (
            HarnessEvent.$is("ItemCompleted")(event) &&
            Predicate.isTagged(event.item, "AssistantMessage")
          ) {
            reply = event.item.text;
          }

          return Effect.void;
        }),
        Stream.takeUntil(
          (event) => HarnessEvent.$is("TurnEnded")(event) || HarnessEvent.$is("Exited")(event)
        ),
        Stream.runDrain
      );

      return reply;
    })
  );

/** The Harness's draft, else the template with a note saying why. */
export const draftAccept = (
  driver: HarnessDriver,
  cwd: string,
  input: DraftInput,
  timeout: Duration.Input = DRAFT_TIMEOUT
) =>
  askHarness(driver, cwd, input).pipe(
    Effect.timeoutOption(timeout),
    Effect.map((reply) => {
      if (Option.isNone(reply)) return templateDraft(input, "the agent took too long to answer");

      if (reply.value === null) return templateDraft(input, "the agent didn't answer");

      return (
        parseDraft(reply.value, input.turns.length) ??
        templateDraft(input, "the agent's answer wasn't a draft")
      );
    }),
    Effect.catch((error) => Effect.succeed(templateDraft(input, error.message)))
  );
