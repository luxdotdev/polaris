/**
 * Pasted images and dropped files: staged on the Host (`attachments.stage`)
 * as soon as they land, then sent with the next Turn by id. The richer drop
 * flows (folders, drag from the Editor) are task B5.
 */
import type { SessionId, WorkspaceId } from "@polaris/protocol";
import { useState } from "react";
import { showRefusal } from "./dispatch.ts";
import { polaris } from "./bridge.ts";
import type { StagedAttachment } from "./state.ts";

export interface StageTarget {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  readonly sessionId: SessionId | null;
}

const stageOne = async (target: StageTarget, file: File): Promise<StagedAttachment | null> => {
  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await polaris().request("attachments.stage", {
    ...target,
    name: file.name === "" ? "pasted" : file.name,
    mimeType: file.type === "" ? "application/octet-stream" : file.type,
    bytes,
  });

  if (!result.ok) {
    showRefusal(`Couldn't attach ${file.name}`, result.error);

    return null;
  }

  const { id, name, mimeType, size } = result.value;

  return { id, name, mimeType, size };
};

/** Stages files and reports each one staged; `pending` counts uploads in flight. */
export const useStaging = (
  target: StageTarget,
  onStaged: (attachment: StagedAttachment) => void
) => {
  const [pending, setPending] = useState(0);

  const stage = (files: ReadonlyArray<File>) => {
    for (const file of files) {
      setPending((n) => n + 1);
      void stageOne(target, file)
        .then((staged) => (staged === null ? undefined : onStaged(staged)))
        .finally(() => setPending((n) => n - 1));
    }
  };

  return { stage, pending };
};

/** Files on a paste or drop event, if any. */
export const filesOf = (data: DataTransfer | null): ReadonlyArray<File> =>
  data === null ? [] : [...data.files];
