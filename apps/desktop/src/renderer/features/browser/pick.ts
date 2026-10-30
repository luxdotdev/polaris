/**
 * An element picked in the Browser, attached to the session's next message (ENG-618): its
 * screenshot as an image the Harness shows the model, and a note with the page, the selector
 * and the HTML that the Harness lists as a file to read.
 */
import type { BrowserPickResult } from "../../../shared/browserContract.ts";
import { keepThumbnail } from "../attachments/useUploads.ts";
import { type StageTarget, stageFile, thumbnail } from "../attachments/stage.ts";
import {
  patchSessionUi,
  type PickedElement,
  type StagedAttachment,
  uiKey,
} from "../session/state.ts";

/** A file-name stem from the selector: `#todos > li.item` → `element-todos-li-item`. */
export const pickStem = (selector: string) => {
  const words = selector
    .toLowerCase()
    .replace(/:nth-of-type\(\d+\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");

  const stem = words.join("-").slice(0, 40).replace(/-+$/, "");

  return stem === "" ? "element" : `element-${stem}`;
};

/** A Markdown fence longer than any run of backticks in `text`, so it holds it whole. */
const fenceFor = (text: string) =>
  "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((run) => run[0].length + 1)));

/** The note the agent reads: where the element is, how to find it, and what it is. */
export const pickNote = (pick: BrowserPickResult, screenshot: string | null) => {
  const fence = fenceFor(pick.html);

  return [
    "# Element picked in the Browser",
    "",
    "The user picked this element on a page in the session's Browser.",
    "",
    `- Page: ${pick.title === "" ? "(untitled)" : pick.title}`,
    `- URL: ${pick.url}`,
    `- CSS selector: \`${pick.selector}\``,
    screenshot === null ? "- Screenshot: none" : `- Screenshot: ${screenshot}`,
    "",
    "## HTML (outer, excerpt)",
    "",
    `${fence}html`,
    pick.html,
    fence,
    "",
  ].join("\n");
};

const fileOf = (bytes: Uint8Array, name: string, type: string) =>
  // SAFETY: IPC hands main's bytes over in a plain ArrayBuffer, never a shared one.
  new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

const staged = (attachment: StagedAttachment, pick: PickedElement): StagedAttachment => ({
  id: attachment.id,
  name: attachment.name,
  mimeType: attachment.mimeType,
  size: attachment.size,
  hostPath: attachment.hostPath,
  width: attachment.width,
  height: attachment.height,
  pick,
});

let picks = 0;

/**
 * Stages the pick on the session's Host and adds it to the composer as one chip. Stage
 * failures say so in a toast (`stageFile`); false when nothing was attached.
 */
export const attachPick = async (
  target: StageTarget & { sessionId: string },
  pick: BrowserPickResult
) => {
  const stem = pickStem(pick.selector);
  const meta = { key: `pick-${++picks}`, selector: pick.selector, url: pick.url, html: pick.html };

  const png =
    pick.screenshot.byteLength === 0 ? null : fileOf(pick.screenshot, `${stem}.png`, "image/png");

  const [shot, thumb] =
    png === null
      ? [null, null]
      : await Promise.all([stageFile(target, png, png.name), thumbnail(png)]);

  if (shot !== null && thumb !== null) keepThumbnail(shot.id, thumb);

  const text = new TextEncoder().encode(pickNote(pick, shot?.hostPath ?? null));
  const note = await stageFile(target, fileOf(text, `${stem}.md`, "text/markdown"), `${stem}.md`);

  const attached = [shot, note].flatMap((a) => (a === null ? [] : [staged(a, meta)]));

  if (attached.length > 0)
    patchSessionUi(uiKey(target.hostKey, target.sessionId), (ui) => ({
      attachments: [...ui.attachments, ...attached],
    }));

  return attached.length > 0;
};
