/**
 * Seals a push to one Linked Device (`@polaris/protocol/relay`'s push.ts): HPKE base mode,
 * DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM, info `polaris-push/1`, empty AAD.
 * The sealed form is base64url of `enc ‖ ciphertext`; the app's extension opens it with CryptoKit.
 */
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import {
  encodePushMessage,
  fromBase64Url,
  MAX_WAKE_PAYLOAD_CHARS,
  PUSH_ENC_BYTES,
  PUSH_HPKE_INFO,
  type PushMessage,
  toBase64Url,
} from "@polaris/protocol/relay";
import { Option } from "effect";

export const pushSuite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

const info = new TextEncoder().encode(PUSH_HPKE_INFO);

/** AES-256-GCM's tag. */
const TAG_BYTES = 16;

/** The largest plaintext whose sealed base64url form fits a wake (RV3). */
export const MAX_PUSH_PLAINTEXT_BYTES =
  Math.floor((MAX_WAKE_PAYLOAD_CHARS * 3) / 4) - PUSH_ENC_BYTES - TAG_BYTES;

const plaintextBytes = (message: PushMessage) =>
  new TextEncoder().encode(encodePushMessage(message)).byteLength;

/** `text` cut to at most `points` code points, ending in an ellipsis when cut. */
const shorten = (text: string, points: number) => {
  const chars = Array.from(text);

  return chars.length <= points ? text : `${chars.slice(0, Math.max(0, points - 1)).join("")}…`;
};

/** The longest cut of `field` that fits, by binary search over code points. */
const fitField = (message: PushMessage, field: "title" | "subtitle" | "body") => {
  let low = 0;
  let high = Array.from(message[field]).length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    const fits =
      plaintextBytes({ ...message, [field]: shorten(message[field], middle) }) <=
      MAX_PUSH_PLAINTEXT_BYTES;

    if (fits) low = middle;
    else high = middle - 1;
  }

  return { ...message, [field]: shorten(message[field], low) };
};

/** `message` with its body, then subtitle, then title shortened until its sealed wake fits. */
export const fitPush = (message: PushMessage): PushMessage => {
  let fitted = message;

  for (const field of ["body", "subtitle", "title"] as const) {
    if (plaintextBytes(fitted) <= MAX_PUSH_PLAINTEXT_BYTES) return fitted;
    fitted = fitField(fitted, field);
  }

  return fitted;
};

/**
 * `message`, fitted, sealed to `pushKey` (uncompressed P-256, base64url), as a wake's
 * payload. Over `MAX_WAKE_PAYLOAD_CHARS` only when the fixed fields alone are too long.
 */
export const sealPush = async (pushKey: string, message: PushMessage): Promise<string> => {
  const key = Option.getOrThrow(fromBase64Url(pushKey));
  const recipientPublicKey = await pushSuite.kem.deserializePublicKey(new Uint8Array(key));
  const sender = await pushSuite.createSenderContext({ recipientPublicKey, info });

  const sealed = new Uint8Array(
    await sender.seal(new TextEncoder().encode(encodePushMessage(fitPush(message))))
  );

  const out = new Uint8Array(PUSH_ENC_BYTES + sealed.byteLength);
  out.set(new Uint8Array(sender.enc));
  out.set(sealed, PUSH_ENC_BYTES);

  return toBase64Url(out);
};

/** Opens a sealed push with the device's private key: what the extension does, for tests. */
export const openPush = async (privateKey: CryptoKey, sealed: string): Promise<string> => {
  const bytes = Option.getOrThrow(fromBase64Url(sealed));

  const recipient = await pushSuite.createRecipientContext({
    recipientKey: privateKey,
    enc: new Uint8Array(bytes.subarray(0, PUSH_ENC_BYTES)),
    info,
  });

  return new TextDecoder().decode(
    await recipient.open(new Uint8Array(bytes.subarray(PUSH_ENC_BYTES)))
  );
};
