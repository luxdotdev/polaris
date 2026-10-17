import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MachineView } from "../../../shared/api.ts";
import { RemoteSettings, WINDOWS_REMOTE_COMMAND } from "./HostDetails.tsx";

const machine = (patch: Partial<MachineView> = {}): MachineView => ({
  daemon: null,
  key: "pc",
  kind: "ssh",
  label: "Gaming PC",
  colour: null,
  alias: "pc",
  target: null,
  enabled: true,
  forwardAgent: false,
  remoteCommand: null,
  status: null,
  install: null,
  ...patch,
});

describe("a Host's remote command", () => {
  test("a POSIX Host can override what ssh runs", () => {
    const html = renderToStaticMarkup(<RemoteSettings machine={machine()} />);

    expect(html).toContain('aria-label="Remote command"');
    expect(html).not.toContain(WINDOWS_REMOTE_COMMAND);
  });

  test("a Windows Host offers no override, since its connection ignores one", () => {
    const html = renderToStaticMarkup(
      <RemoteSettings machine={machine({ windowsShell: "powershell" })} />
    );

    expect(html).not.toContain('aria-label="Remote command"');
    expect(html).toContain(WINDOWS_REMOTE_COMMAND);
  });
});
