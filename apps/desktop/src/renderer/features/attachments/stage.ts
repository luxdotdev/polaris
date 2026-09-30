/**
 * Moving bytes to the Host: stage a file (`attachments.stage`, the bytes sent
 * as a blob), copy a staged one into the Workspace (`cp` through
 * `terminal.open`), and a small thumbnail for image chips.
 */
import type { SessionId, TerminalId, WorkspaceId } from "@polaris/protocol";
import { PixelFailedIcon, PixelFolderIcon, showToast } from "@polaris/ui";
import { Predicate } from "effect";
import { createElement } from "react";
import { polaris } from "../session/bridge.ts";
import { showRefusal } from "../session/dispatch.ts";
import { copyArgv, copyOutcome, joinPath } from "./model.ts";

export interface StageTarget {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  readonly sessionId: SessionId | null;
}

export const stageFile = async (target: StageTarget, file: File, name: string) => {
  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await polaris().request("attachments.stage", {
    ...target,
    name,
    mimeType: file.type === "" ? "application/octet-stream" : file.type,
    bytes,
  });

  if (!result.ok) {
    showRefusal(`Couldn't attach ${name}`, result.error);

    return null;
  }

  return result.value;
};

/** Runs the copy on the Host and waits for its exit code; null when it never said. */
const runCopy = (hostKey: string, argv: ReadonlyArray<string>, cwd: string) =>
  new Promise<number | null>((resolve) => {
    void polaris()
      .request("terminal.open", { hostKey, cwd, argv: [...argv], cols: 80, rows: 4 })
      .then((opened) => {
        if (!opened.ok) {
          resolve(null);

          return;
        }

        const terminalId: TerminalId = opened.value.terminalId;
        let code: number | null = null;

        const stop = polaris().subscribe(
          "terminal",
          { hostKey, terminalId },
          {
            items: (items) => {
              for (const item of items) if (Predicate.isTagged(item, "Exit")) code = item.code;
            },
            end: () => {
              stop();
              void polaris().request("terminal.close", { hostKey, terminalId });
              resolve(code);
            },
          }
        );
      });
  });

/** Stages the file, then copies it into `dir` on the Host; says how it went in a toast. */
export const copyIntoWorkspace = async (
  target: StageTarget,
  file: File,
  name: string,
  dir: { readonly path: string; readonly shown: string }
) => {
  const staged = await stageFile(target, file, name);

  if (staged === null) return;

  const to = joinPath(dir.path, name);
  const code = await runCopy(target.hostKey, copyArgv(staged.hostPath, to), dir.path);

  const outcome = copyOutcome(code, name, dir.shown);

  showToast({
    source: "starlight",
    icon: createElement(outcome.ok ? PixelFolderIcon : PixelFailedIcon, { size: 16 }),
    title: outcome.title,
    message: outcome.message,
  });
};

const THUMB = 64;

/** A 64px data URL for an image chip; small enough to keep with the draft. */
export const thumbnail = async (file: File): Promise<string | null> => {
  if (!file.type.startsWith("image/")) return null;

  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");

    canvas.width = THUMB;
    canvas.height = THUMB;
    // Centre crop to a square, as the chip shows it.
    canvas
      .getContext("2d")
      ?.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        THUMB,
        THUMB
      );
    bitmap.close();

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
};
