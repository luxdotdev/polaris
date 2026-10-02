import { Schema } from "effect";

const decode = Schema.decodeUnknownSync(
  Schema.Struct({ email: Schema.String, website: Schema.String })
);

export function validEmail(email: string): boolean {
  if (email.length > 254) return false;
  const [local = "", domain = ""] = email.split("@");

  return (
    local.length <= 64 &&
    /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local) &&
    domain.length <= 253 &&
    domain.includes(".") &&
    domain
      .split(".")
      .every((part) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(part)) &&
    email.split("@").length === 2
  );
}

export async function readSubmission(request: Request) {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      size += value.byteLength;

      if (size > 2048) {
        await reader.cancel();
        throw new Error("Body too large");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const submission = decode(JSON.parse(new TextDecoder().decode(bytes)));

  return { email: submission.email.trim(), website: submission.website };
}
