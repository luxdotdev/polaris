import {
  type DesktopSnapshot,
  DesktopSnapshot as SnapshotSchema,
  INSPECTION_CAPABILITY,
} from "@polaris/protocol";
import type { LiveSession } from "@polaris/client";
import { BrowserWindow } from "electron";
import { Effect, Schema, Stream } from "effect";
import { inspectionView } from "../shared/inspectionView.ts";

/** Only Polaris's renderer is inspected; no agent-supplied JavaScript or window id. */
const snapshot = (): Effect.Effect<DesktopSnapshot, unknown> =>
  Effect.tryPromise(async () => ({
    capturedAt: Date.now(),
    windows: await Promise.all(
      BrowserWindow.getAllWindows()
        .filter((window) => !window.isDestroyed())
        .slice(0, 16)
        .map(async (window) => ({
          id: window.id,
          title: window.getTitle().slice(0, 512),
          focused: window.isFocused(),
          bounds: window.getBounds(),
          view: Schema.decodeUnknownSync(Schema.String)(
            await window.webContents.executeJavaScriptInIsolatedWorld(1025, [
              { code: `(${inspectionView.toString()}).call(globalThis)` },
            ])
          ),
        }))
    ),
  })).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SnapshotSchema)));

/** One request stream per live Host connection; reconnect closes the old registration. */
export const serveInspection = (sessions: Stream.Stream<LiveSession | null>): Effect.Effect<void> =>
  sessions.pipe(
    Stream.switchMap((session) =>
      session === null || !session.capabilities.includes(INSPECTION_CAPABILITY)
        ? Stream.empty
        : session.client["inspection.watch"]({}).pipe(
            Stream.mapEffect(({ requestId }) =>
              snapshot().pipe(
                Effect.orElseSucceed(() => null),
                Effect.flatMap((snapshot) =>
                  session.client["inspection.respond"]({ requestId, snapshot })
                ),
                Effect.ignore
              )
            ),
            Stream.catch(() => Stream.empty)
          )
    ),
    Stream.runDrain
  );
