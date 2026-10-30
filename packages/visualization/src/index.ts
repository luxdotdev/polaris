/**
 * Visualizations (ENG-594, ADR 0089): the `visualize` tool's input, the validation the
 * Daemon runs when the agent submits, the frame document, and the frame↔app messages.
 *
 * CONTRACT STUB: the shapes below are fixed for the Daemon, Desktop and Mobile tasks to code
 * against; the bodies are filled in by the frame package task (ENG-596).
 */
import { Schema } from "effect";

/** Hard cap on `html`, in UTF-8 bytes. */
export const VISUALIZATION_MAX_BYTES = 128 * 1024;

export const VISUALIZATION_TITLE_MAX = 120;

/** The `visualize` tool's input, as the Harness sends it. */
export const VisualizeInput = Schema.Struct({
  title: Schema.String,
  /** A body fragment: no `<!doctype>`, `<html>`, `<head>` or `<body>`. */
  html: Schema.String,
  /** The id of an earlier Visualization in this Agent Session that this one replaces. */
  replaces: Schema.optionalKey(Schema.String),
});

export type VisualizeInput = typeof VisualizeInput.Type;

/** The tool result on success. `id` is the Tool Call id; `replaces` refers to it later. */
export const VisualizeResult = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  bytes: Schema.Int,
});

export type VisualizeResult = typeof VisualizeResult.Type;

/** One reason the Daemon refused a submission; `fix` is advice the agent can act on. */
export interface VisualizationProblem {
  readonly rule:
    | "too-large"
    | "empty"
    | "title"
    | "full-document"
    | "external-url"
    | "navigation"
    | "viewport-units";
  readonly message: string;
  readonly fix: string;
}

/** Checks a submission; an empty array means it is accepted. Pure and synchronous. */
export const validateVisualization = (
  _input: VisualizeInput
): ReadonlyArray<VisualizationProblem> => [];

/** The Visuals setting: how readily the agent reaches for `visualize`; `off` removes the tool. */
export const VisualsLevel = Schema.Literals(["rich", "simple", "off"]);

export type VisualsLevel = typeof VisualsLevel.Type;

/** The theme token names a Client reads from its own theme and sends into the frame. */
export const FRAME_TOKEN_NAMES: ReadonlyArray<string> = [];

/** Token name → value; values longer than 128 chars or containing `<>{}` are dropped. */
export type FrameTokens = Readonly<Record<string, string>>;

export interface FrameDocumentOptions {
  readonly html: string;
  readonly title: string;
  readonly tokens: FrameTokens;
  readonly scheme: "light" | "dark";
  /** The frame's saved `pv.state`, restored before the agent's script runs. */
  readonly state?: unknown;
  /** `inline` sizes to content and reports height; `expanded` fills its container. */
  readonly mode: "inline" | "expanded";
}

/**
 * The complete document for a frame's `srcdoc` (Desktop) or WebView `html` (Mobile): CSP meta
 * first, then tokens, Chart.js, D3, the Polaris kit (`pv`), and the agent's fragment.
 */
export const buildFrameDocument = (_options: FrameDocumentOptions): string => "";

/** Messages the frame posts to the app. Accept only from the frame's own window. */
export const FrameMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("pv:height"), height: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("pv:open-link"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("pv:state"), state: Schema.Unknown }),
]);

export type FrameMessage = typeof FrameMessage.Type;

/** Messages the app posts into the frame. */
export const HostMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pv:theme"),
    tokens: Schema.Record(Schema.String, Schema.String),
    scheme: Schema.Literals(["light", "dark"]),
  }),
]);

export type HostMessage = typeof HostMessage.Type;

/** Inline frame heights are clamped to this range, in CSS px. */
export const FRAME_HEIGHT_MIN = 80;

export const FRAME_HEIGHT_MAX = 6000;
