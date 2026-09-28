/**
 * Builds the SDK user message for a Turn (or a steer): the prompt text, images
 * inlined as base64 content blocks, and every other attachment referenced by
 * its staged path on the Host so Claude reads it with its own tools.
 */
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { Attachment } from "@polaris/protocol"
import { Effect } from "effect"
import { HarnessError } from "../HarnessDriver.ts"

/** Image types the Messages API accepts inline. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
/** The API's per-image limit is 5 MB; larger images are passed by path instead. */
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image"
      source: {
        type: "base64"
        media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        data: string
      }
    }

export const isInlineImage = (a: Attachment): boolean =>
  INLINE_IMAGE_TYPES.has(a.mimeType) && a.size <= MAX_INLINE_IMAGE_BYTES

export const attachmentNote = (files: ReadonlyArray<Attachment>): string =>
  [
    "Attached files (staged on this machine; read them from these paths):",
    ...files.map((f) => `- ${f.name} (${f.mimeType}): ${f.hostPath}`),
  ].join("\n")

export const buildUserMessage = Effect.fn("claude.buildUserMessage")(function* (options: {
  readonly uuid: string
  readonly prompt: string
  readonly attachments: ReadonlyArray<Attachment>
  /** Read a staged file; injectable for tests. */
  readonly readFile?: (path: string) => Promise<Uint8Array>
}) {
  const readFile = options.readFile ?? ((path: string) => Bun.file(path).bytes())
  const images = options.attachments.filter(isInlineImage)
  const others = options.attachments.filter((a) => !isInlineImage(a))

  const content: ContentBlock[] = []
  for (const image of images) {
    const bytes = yield* Effect.tryPromise({
      try: () => readFile(image.hostPath),
      catch: (cause) =>
        new HarnessError({
          harness: "claude",
          message: `Could not read the attachment ${image.name}`,
          cause,
        }),
    })
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType as "image/png",
        data: Buffer.from(bytes).toString("base64"),
      },
    })
  }
  const text = others.length > 0 ? `${options.prompt}\n\n${attachmentNote(others)}` : options.prompt
  content.push({ type: "text", text })

  const message: SDKUserMessage = {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    uuid: options.uuid as NonNullable<SDKUserMessage["uuid"]>,
    origin: { kind: "human" },
  }
  return message
})
