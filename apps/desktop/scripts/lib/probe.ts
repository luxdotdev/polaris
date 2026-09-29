/**
 * Runs in the renderer (as `page.evaluate` source) during the smoke test: the
 * blob, terminal, file and git RPCs round-trip through the typed IPC bridge.
 */
export interface ProbeInput {
  /** A file larger than the Daemon's inline limit, so `files.read` returns a blob. */
  readonly bigFile: string;
  readonly repo: string;
}

export const probeSource = ({ bigFile, repo }: ProbeInput) => `(async () => {
  const api = window.polaris;
  const steps = (window.__probeSteps = []);
  const must = (result, what) => {
    steps.push(what);
    if (!result.ok) throw new Error(what + ": " + result.error.code + " " + result.error.message);
    return result.value;
  };
  const hostKey = "local";
  const read = must(await api.request("files.read", { hostKey, path: ${JSON.stringify(bigFile)}, offset: null, length: null }), "files.read");
  const status = must(await api.request("git.status", { hostKey, cwd: ${JSON.stringify(repo)} }), "git.status");
  const diff = must(await api.request("git.diff", { hostKey, cwd: ${JSON.stringify(repo)}, spec: { _tag: "Range", base: "HEAD~1", head: "HEAD" } }), "git.diff");
  // A cached Snapshot may predate the proof Workspace; it then arrives as an event.
  const workspaceId = await new Promise((resolve) => {
    const close = api.subscribe("host", { hostKey }, { items: (items) => {
      for (const i of items) {
        const found = i._tag === "Snapshot" ? i.workspaces[0]
          : i._tag === "Event" && i.envelope.event._tag === "WorkspaceRegistered" ? i.envelope.event.workspace : undefined;
        if (found) { close(); resolve(found.id); return; }
      }
    } });
  });
  const staged = must(await api.request("attachments.stage", { hostKey, sessionId: null, workspaceId, name: "probe.bin", mimeType: "application/octet-stream", bytes: new Uint8Array(300000).fill(7) }), "attachments.stage");
  const { terminalId } = must(await api.request("terminal.open", { hostKey, cwd: ${JSON.stringify(repo)}, cols: 80, rows: 24, argv: ["sh", "-c", "echo polaris-terminal-ok"] }), "terminal.open");
  steps.push("terminal.attach");
  const terminal = await new Promise((resolve) => {
    let text = "";
    api.subscribe("terminal", { hostKey, terminalId }, {
      items: (items) => { for (const i of items) if (i._tag === "Output") text += new TextDecoder().decode(i.data); },
      end: () => resolve(text),
    });
  });
  return {
    read: { size: read.size, kind: read.content.kind, bytes: read.content.kind === "bytes" ? read.content.bytes.length : read.content.text.length },
    branch: status.branch,
    diffBytes: diff.bytes.length,
    staged: staged.size,
    terminal: terminal.includes("polaris-terminal-ok"),
  };
})()`;
