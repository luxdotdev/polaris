import { describe, expect, test } from "bun:test"
import { LAUNCHD_LABEL, launchdPlist, type ServiceSpec, systemdUnit } from "./templates.ts"

const spec: ServiceSpec = {
  program: "/Users/ada/.polaris/bin/current/polaris",
  args: ["serve"],
  home: "/Users/ada/.polaris",
  logDir: "/Users/ada/.polaris/logs",
  env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
}

describe("launchdPlist", () => {
  const plist = launchdPlist(spec)

  test("runs the stable launcher with serve", () => {
    expect(plist).toContain(`<key>Label</key>\n    <string>${LAUNCHD_LABEL}</string>`)
    expect(plist).toContain(
      "<array>\n      <string>/Users/ada/.polaris/bin/current/polaris</string>\n      <string>serve</string>\n    </array>",
    )
  })

  test("keeps the Daemon alive and logs under ~/.polaris/logs", () => {
    expect(plist).toContain("<key>KeepAlive</key>\n    <true/>")
    expect(plist).toContain("<key>RunAtLoad</key>\n    <true/>")
    expect(plist).toContain("<string>/Users/ada/.polaris/logs/daemon.err.log</string>")
    expect(plist).toContain("<string>/Users/ada/.polaris/logs/daemon.out.log</string>")
  })

  test("passes POLARIS_HOME and PATH, sorted", () => {
    const envBlock = plist.slice(plist.indexOf("EnvironmentVariables"))
    expect(envBlock.indexOf("PATH")).toBeLessThan(envBlock.indexOf("POLARIS_HOME"))
    expect(envBlock).toContain("<string>/Users/ada/.polaris</string>")
  })

  test("escapes XML", () => {
    const odd = launchdPlist({ ...spec, home: `/tmp/a&b<"c">` })
    expect(odd).toContain("/tmp/a&amp;b&lt;&quot;c&quot;&gt;")
    expect(odd).not.toContain(`a&b`)
  })

  test("is deterministic, so install can compare before rewriting", () => {
    expect(launchdPlist(spec)).toBe(plist)
  })
})

describe("systemdUnit", () => {
  const unit = systemdUnit({ ...spec, program: "/home/ada/.polaris/bin/current/polaris" })

  test("restarts always and is wanted by the default target", () => {
    expect(unit).toContain('ExecStart="/home/ada/.polaris/bin/current/polaris" "serve"')
    expect(unit).toContain("Restart=always")
    expect(unit).toContain("WantedBy=default.target")
    expect(unit).toContain("StandardError=append:/Users/ada/.polaris/logs/daemon.err.log")
  })

  test("quotes specifiers and variables in the environment", () => {
    const odd = systemdUnit({ ...spec, env: { PATH: "/a%b/$HOME" } })
    expect(odd).toContain('Environment="PATH=/a%%b/$$HOME"')
  })
})
