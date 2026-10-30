/**
 * Visualizations in the conversation (Paper "Visualizations", V1 to V6): shown, drawing, revised
 * below, stopped and a refused call; `visualizations-30` is the 30-frame performance scene.
 */
import { TurnItem } from "@polaris/protocol";
import { VISUALIZATION_EXAMPLES } from "@polaris/visualization/examples";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { model, session, turn, view } from "./fixtures.ts";

const I = TurnItem.cases;

const EXAMPLES = Object.values(VISUALIZATION_EXAMPLES);

const result = (id: string, title: string, html: string) =>
  JSON.stringify({ id, title, bytes: new TextEncoder().encode(html).byteLength });

const drew = (
  id: string,
  example: { readonly title: string; readonly html: string },
  replaces?: string
) =>
  I.ToolCall.make({
    id,
    name: "mcp__polaris__visualize",
    kind: "mcp",
    mcp: { server: "polaris", tool: "visualize" },
    input:
      replaces === undefined
        ? { title: example.title, html: example.html }
        : { title: example.title, html: example.html, replaces },
    output: [{ type: "text", text: result(`viz_${id}`, example.title, example.html) }],
    status: "completed",
  });

const read = (id: string, path: string) =>
  I.ToolCall.make({
    id,
    name: "Read",
    kind: "read",
    mcp: null,
    input: { file_path: path },
    output: null,
    status: "completed",
  });

const say = (id: string, text: string) => I.AssistantMessage.make({ id, text });

/** A page that loads itself again: the frame is stopped and removed. */
const RELOADS = {
  title: "Reloads itself",
  html: '<p class="pv-muted">Loading…</p><script>setTimeout(() => location.reload(), 400)</script>',
};

export const visualizations = (): SessionModel => {
  const s = session("s-visualizations", { title: "Mortgage options", state: "working" });
  const [loan, flow, comparison, timeline] = EXAMPLES;

  if (
    loan === undefined ||
    flow === undefined ||
    comparison === undefined ||
    timeline === undefined
  )
    throw new Error("the visualization examples changed");

  const running = I.ToolCall.make({
    id: "v-draw",
    name: "mcp__polaris__visualize",
    kind: "mcp",
    mcp: { server: "polaris", tool: "visualize" },
    input: { title: "Rate sensitivity" },
    output: null,
    status: "running",
    startedAt: new Date(Date.now() - 4000).toISOString(),
  });

  return model({
    session: s,
    turns: [
      view(
        turn(s.id, 1, "Compare the two loans, show me the payments and the timeline", "working"),
        [
          read("r1", "docs/loans/offer-a.md"),
          read("r2", "docs/loans/offer-b.md"),
          say("m1", "Here are the two offers side by side."),
          drew("v1", comparison),
          read("r3", "docs/loans/fees.md"),
          read("r4", "docs/loans/rates.md"),
          say("m2", "I missed the arrangement fee; here's the comparison again with it included."),
          drew("v2", comparison, "viz_v1"),
          drew("v3", loan),
          I.ToolCall.make({
            id: "v-refused",
            name: "mcp__polaris__visualize",
            kind: "mcp",
            mcp: { server: "polaris", tool: "visualize" },
            input: { title: "Live rates", html: '<img src="https://rates.example/today.png">' },
            output:
              "E-VISUAL-EXTERNAL-URL: The page loads https://rates.example/today.png\nFix: Inline the data you computed instead of loading it.",
            status: "completed",
          }),
          drew("v4", flow),
          drew("v5", RELOADS),
          drew("v6", timeline),
          say("m3", "Drawing the sensitivity next."),
        ],
        [[running.id, { item: running, text: "", output: "" }]]
      ),
    ],
  });
};

/** Thirty Visualizations in one Turn, for the frame budget and scroll performance. */
export const visualizations30 = (): SessionModel => {
  const s = session("s-visualizations-30", { title: "Thirty visualizations", state: "idle" });

  const items = Array.from({ length: 30 }, (_, n) => {
    const example = EXAMPLES[n % EXAMPLES.length] ?? RELOADS;

    return [
      say(`m${n}`, `Visualization ${n + 1} of 30.`),
      drew(`p${n}`, { ...example, title: `${example.title} · ${n + 1}` }),
    ];
  }).flat();

  return model({
    session: s,
    turns: [view(turn(s.id, 1, "Draw thirty of them", "completed"), items)],
  });
};
