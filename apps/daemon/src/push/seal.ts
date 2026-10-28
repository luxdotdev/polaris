/**
 * Seals a push to one Linked Device (`@polaris/protocol/relay`'s push.ts): HPKE base mode,
 * DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM, info `polaris-push/1`, empty AAD.
 * The sealed form is base64url of `enc ‖ ciphertext`; the app's extension opens it with CryptoKit.
 */
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import {
  encodePushMessage,
  fromBase64Url,
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

/** `message` sealed to `pushKey` (uncompressed P-256, base64url), as a wake's payload. */
export const sealPush = async (pushKey: string, message: PushMessage): Promise<string> => {
  const key = Option.getOrThrow(fromBase64Url(pushKey));
  const recipientPublicKey = await pushSuite.kem.deserializePublicKey(new Uint8Array(key));
  const sender = await pushSuite.createSenderContext({ recipientPublicKey, info });

  const sealed = new Uint8Array(
    await sender.seal(new TextEncoder().encode(encodePushMessage(message)))
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
