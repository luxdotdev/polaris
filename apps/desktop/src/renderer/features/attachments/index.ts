/**
 * Attachments in the composer (ENG-180): paste or drop files to stage them on
 * the session's Host with a chip each; ⌥-drop copies them into the Workspace.
 * The session feature mounts `AttachmentDrop` and `AttachmentTray` around its
 * composer and keeps the staged list in its draft.
 */
export { AttachmentDrop, type AttachmentDropProps } from "./ui/AttachmentDrop.tsx";

export { AttachmentTray, type AttachmentTrayProps } from "./ui/AttachmentTray.tsx";

export { useUploads, type UploadTarget } from "./useUploads.ts";

export type { DropMode, Upload } from "./model.ts";

export { AttachmentsPage } from "./ui/AttachmentsPage.tsx";

export { SentAttachments, type SentAttachment } from "./ui/SentAttachments.tsx";
