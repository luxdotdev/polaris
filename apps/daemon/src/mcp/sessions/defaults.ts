/** Agent starts read the same per-Host defaults the Desktop App edits (ADR 0120). */
import { HostSessionDefaults } from "@polaris/protocol";
import { Schema } from "effect";
import { hostSettings, hostSettingsPath } from "../../settings/index.ts";
import { safeSessionDefaults, type SessionDefaultsFor } from "./control.ts";

export const hostSessionDefaultsAt =
  (path: () => string = hostSettingsPath): SessionDefaultsFor =>
  (harness) =>
    Schema.decodeUnknownSync(HostSessionDefaults)(
      hostSettings(path()).get("sessions.defaults").value
    )[harness] ?? safeSessionDefaults(harness);
