/** A reply streaming a fenced block, and the same reply finished (`#preview/code-stream`, `-done`). */
import { TurnItem } from "@polaris/protocol";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { model, session, turn, view } from "./fixtures.ts";

const I = TurnItem.cases;

const CODE = [
  'import { Effect, Schedule } from "effect";',
  "",
  "/* Retries a dropped connection: twice, 250 ms apart. */",
  "export const resume = (host: Host) =>",
  "  connect(host).pipe(",
  '    Effect.retry(Schedule.spaced("250 millis").pipe(Schedule.compose(Schedule.recurs(2)))),',
  "    Effect.tap(() => Effect.log(`resumed ${host.name}`))",
  "  );",
];

const INTRO = "The resume path retries twice before the Connection State says Offline:\n\n";

const reply = (lines: number) => `${INTRO}\`\`\`ts\n${CODE.slice(0, lines).join("\n")}`;

const codeStream = (done: boolean): SessionModel => {
  const s = session(done ? "s-code-done" : "s-code-stream", {
    title: "Retry a dropped connection",
    state: "working",
  });

  const t = turn(s.id, 3, "Retry a dropped connection twice", done ? "completed" : "working");

  // Mid-stream: six lines in and the seventh half typed.
  const partial = `${reply(6)}\n    Effect.tap(() => Effect.lo`;

  return model({
    session: s,
    turns: [
      done
        ? view(t, [
            I.AssistantMessage.make({ id: "m-code", text: `${reply(CODE.length)}\n\`\`\`` }),
          ])
        : view(t, [], [["m-code", { item: null, text: partial, output: "" }]]),
    ],
  });
};

export const codeStreaming = () => codeStream(false);

export const codeStreamDone = () => codeStream(true);
