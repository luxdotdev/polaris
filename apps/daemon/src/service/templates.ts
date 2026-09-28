/**
 * User-service definitions for the Daemon, as pure functions of their inputs.
 * The service always runs `~/.polaris/bin/current/polaris serve`, so an
 * upgrade only repoints the `current` symlink.
 */

export const LAUNCHD_LABEL = "dev.lux.polaris"
export const SYSTEMD_UNIT = "polaris.service"

export interface ServiceSpec {
  /** Absolute path of the stable launcher, `~/.polaris/bin/current/polaris`. */
  readonly program: string
  readonly args: ReadonlyArray<string>
  /** `POLARIS_HOME`, passed through so a non-default home keeps working. */
  readonly home: string
  readonly logDir: string
  /** Extra environment for the Daemon (e.g. PATH so Harnesses are found). */
  readonly env: Readonly<Record<string, string>>
}

const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")

/** A launchd LaunchAgent for `~/Library/LaunchAgents/dev.lux.polaris.plist`. */
export const launchdPlist = (spec: ServiceSpec): string => {
  const string = (value: string) => `<string>${xmlEscape(value)}</string>`
  const env = { POLARIS_HOME: spec.home, ...spec.env }
  const envEntries = Object.keys(env)
    .sort()
    .map(
      (key) => `      <key>${xmlEscape(key)}</key>\n      ${string(env[key as keyof typeof env]!)}`,
    )
    .join("\n")
  const argv = [spec.program, ...spec.args].map((arg) => `      ${string(arg)}`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    ${string(LAUNCHD_LABEL)}
    <key>ProgramArguments</key>
    <array>
${argv}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${envEntries}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    ${string(`${spec.logDir}/daemon.out.log`)}
    <key>StandardErrorPath</key>
    ${string(`${spec.logDir}/daemon.err.log`)}
  </dict>
</plist>
`
}

/** systemd quotes: wrap in double quotes, escape backslash, quote, `%` and `$`. */
const systemdQuote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$$$")}"`

/** A systemd `--user` unit for `~/.config/systemd/user/polaris.service`. */
export const systemdUnit = (spec: ServiceSpec): string => {
  const env = { POLARIS_HOME: spec.home, ...spec.env }
  const envLines = Object.keys(env)
    .sort()
    .map((key) => `Environment=${systemdQuote(`${key}=${env[key as keyof typeof env]!}`)}`)
    .join("\n")
  const execStart = [spec.program, ...spec.args].map(systemdQuote).join(" ")
  return `[Unit]
Description=Polaris Daemon
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
${envLines}
Restart=always
RestartSec=2
StandardOutput=append:${spec.logDir}/daemon.out.log
StandardError=append:${spec.logDir}/daemon.err.log

[Install]
WantedBy=default.target
`
}
