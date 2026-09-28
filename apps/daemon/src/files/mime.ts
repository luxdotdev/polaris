/**
 * Mime type detection for `files.read`: magic bytes first (so a PNG named
 * `.txt` is still an image), then the extension, then a text/binary sniff.
 */
import { extname } from "node:path";

const EXTENSIONS: Record<string, string> = {
  // Previewed by the Client.
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  // Text the Editor knows by type.
  ".json": "application/json",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/typescript",
  ".mts": "text/typescript",
  ".cts": "text/typescript",
  ".tsx": "text/typescript",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".sh": "application/x-sh",
  // Binary.
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

const startsWith = (head: Uint8Array, signature: ReadonlyArray<number>, at = 0): boolean =>
  head.length >= at + signature.length && signature.every((byte, i) => head[at + i] === byte);

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

const sniffMagic = (head: Uint8Array): string | null => {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"))) return "image/gif";
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(head, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (startsWith(head, [0x1f, 0x8b])) return "application/gzip";
  if (startsWith(head, [0x00, 0x61, 0x73, 0x6d])) return "application/wasm";
  return null;
};

/** Text when there are no NUL bytes and the head is valid UTF-8 (a cut final character is fine). */
export const looksLikeText = (head: Uint8Array): boolean => {
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
};

export const isTextMime = (mime: string): boolean =>
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime === "application/xml" ||
  mime === "application/yaml" ||
  mime === "application/toml" ||
  mime === "application/x-sh" ||
  mime === "image/svg+xml";

/**
 * @param path used for the extension
 * @param head the first bytes of the file (up to 8 KiB is plenty)
 */
export const detectMimeType = (path: string, head: Uint8Array): string => {
  const magic = sniffMagic(head);
  if (magic !== null) return magic;
  const byExtension = EXTENSIONS[extname(path).toLowerCase()];
  if (byExtension !== undefined) return byExtension;
  return looksLikeText(head) ? "text/plain" : "application/octet-stream";
};
