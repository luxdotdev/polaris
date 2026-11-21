# Client Settings relay (ADR 0120, ENG-1023)

The Desktop App owns settings.json, validation, application and Undo. Its owned
Host connections open clientSettings.connect with described schemas, defaults,
values and visible-session/activity state. A null stream item acknowledges
registration; subsequent items request changes. publish refreshes the snapshot,
and complete acknowledges persistence or reports validation/application failure.
The connection id comes from the transport; one connection cannot complete
another's request. Canceling the subscription removes its registration and
fails pending changes. Nothing is queued without a connected Client.

list, describe, get and set choose the Client showing the caller's session,
then the most recently active registered Client. Bound MCP tools supply their
authenticated session id. S3 replaces these temporary tools with generated
settings commands and the session's change-settings Grant Approval.

The registry is in memory, has no timers while idle, caps in-flight sets at 64,
and bounds each confirmation wait to ten seconds. Client Settings never enter
the event store or recovery queue. The Mobile App does not register for this
relay. Host connection configuration and private Desktop persistence fields
are not published.

## K integration seam

K supplies the keybinding schema and resolver. Register that schema in
shared/clientSettings.ts and main/settings.ts, add keybindings to SettingsView
and settings.get, and publish its event after applying or undoing the field.
Apply the resolver before rebuilding the native menu; the renderer consumes
the same event. S2 does not copy K's prerequisite files.
