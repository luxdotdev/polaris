import type { VisualizeInput } from "../src/index.ts";

/** A D3 flow chart through pv.flow, with a back edge. */
export const flowChart: VisualizeInput = {
  title: "How a command reaches the event log",
  html: String.raw`<div id="flow"></div>
<p class="pv-caption">A rejected command goes back to the Client with its reason; nothing is written.</p>
<script>
  pv.flow("#flow", {
    label: "A command flows from the Client through the Daemon's decider into the event log, then out to every feed",
    nodes: [
      { id: "client", label: "Client", detail: "Sends a command" },
      { id: "rpc", label: "Transport", detail: "Frames and checks it" },
      { id: "decide", label: "Decider", detail: "Folds state, decides", tone: "accent" },
      { id: "store", label: "Event log", detail: "Appends events" },
      { id: "reject", label: "Rejection", detail: "Reason, no events", tone: "muted" },
      { id: "feeds", label: "Feeds", detail: "Stream to Clients" },
    ],
    edges: [
      { from: "client", to: "rpc" },
      { from: "rpc", to: "decide" },
      { from: "decide", to: "store", label: "accepted" },
      { from: "decide", to: "reject", label: "refused" },
      { from: "store", to: "feeds" },
      { from: "feeds", to: "client", label: "acknowledged" },
    ],
  });
</script>`,
};
